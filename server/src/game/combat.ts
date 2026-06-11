/**
 * Server-side combat engine. All combat math runs here: the unified melee
 * attack table (miss / dodge / crit / hit), armor mitigation, weapon-damage
 * rolls, spell-damage rolls, resource costs and rage generation. Systems and
 * the network layer only ever call into these functions — never roll dice
 * themselves — so the simulation stays authoritative and deterministic to one
 * place.
 */

import {
  ARMOR_CONSTANT,
  ARMOR_PER_LEVEL,
  BASE_DODGE_CHANCE,
  BASE_MISS_CHANCE,
  DEFAULT_LEVEL,
  GCD_MS,
  MONSTER_RESPAWN_MS,
  RAGE_DAMAGE_DIVISOR,
  getSpell,
  type DamageSchool,
} from "@wow/shared";
import {
  ActiveCast,
  Combat,
  Corpse,
  Identity,
  LootTable,
  Power,
  Stats,
  ThreatTable,
} from "../ecs/components.js";
import type { EntityId } from "../ecs/World.js";
import type { GameContext } from "./context.js";
import { distance } from "./util.js";
import {
  effectiveCastTime,
  physicalCritChance,
  spellCritChance,
  stanceMultipliers,
} from "./derive.js";

type AttackOutcome = "miss" | "dodge" | "crit" | "hit";

// ---------------------------------------------------------------------------
// Naming / perspective helpers
// ---------------------------------------------------------------------------

function nameOf(ctx: GameContext, id: EntityId): string {
  return ctx.world.get(id, Identity)?.name ?? `Entity#${id}`;
}
function isPlayer(ctx: GameContext, id: EntityId): boolean {
  return ctx.world.get(id, Identity)?.kind === "player";
}
/** Sentence-start possessive: "Your" for the player, "Name's" otherwise. */
function possCap(ctx: GameContext, id: EntityId): string {
  return isPlayer(ctx, id) ? "Your" : `${nameOf(ctx, id)}'s`;
}
/** Mid-sentence possessive: "your" for the player, "Name's" otherwise. */
function possLow(ctx: GameContext, id: EntityId): string {
  return isPlayer(ctx, id) ? "your" : `${nameOf(ctx, id)}'s`;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Combat-state helpers
// ---------------------------------------------------------------------------

export function enterCombat(ctx: GameContext, id: EntityId): void {
  const combat = ctx.world.get(id, Combat);
  if (combat && !combat.inCombat) combat.inCombat = true;
}

export function interruptCast(
  ctx: GameContext,
  caster: EntityId,
  reason: string,
): void {
  const combat = ctx.world.get(caster, Combat);
  if (!combat?.cast) return;
  const spellName = combat.cast.spellName;
  combat.cast = null;
  ctx.log.push("cast", `${possCap(ctx, caster)} ${spellName} was ${reason}.`);
}

/** Generate rage for an entity (if it uses rage) from a damage event. */
function generateRage(ctx: GameContext, id: EntityId, damage: number): void {
  const power = ctx.world.get(id, Power);
  if (!power || power.type !== "rage" || damage <= 0) return;
  const gained = Math.round(damage / RAGE_DAMAGE_DIVISOR);
  power.current = Math.min(power.max, power.current + gained);
}

// ---------------------------------------------------------------------------
// Combat matrix
// ---------------------------------------------------------------------------

/** Classic armor mitigation: reduction fraction in [0, 1). Level 1 assumed. */
export function armorReduction(armor: number): number {
  if (armor <= 0) return 0;
  const denom = armor + ARMOR_CONSTANT + ARMOR_PER_LEVEL * DEFAULT_LEVEL;
  return armor / denom;
}

/** Roll the unified melee attack table in priority order. */
function rollAttackTable(ctx: GameContext, attacker: EntityId): AttackOutcome {
  // Physical crit includes the Cruelty talent bonus.
  const crit = physicalCritChance(ctx.world, attacker);
  const roll = Math.random() * 100;
  let cursor = BASE_MISS_CHANCE;
  if (roll < cursor) return "miss";
  cursor += BASE_DODGE_CHANCE;
  if (roll < cursor) return "dodge";
  cursor += crit;
  if (roll < cursor) return "crit";
  return "hit";
}

/**
 * Core damage application: subtract HP, build threat, generate rage for both
 * participants, enter combat, interrupt the victim's cast, handle death.
 * Returns the HP actually removed. Callers compose the combat-log line.
 */
function inflict(
  ctx: GameContext,
  source: EntityId,
  target: EntityId,
  amount: number,
  _school: DamageSchool,
  threatMult: number,
): number {
  const stats = ctx.world.get(target, Stats);
  if (!stats || stats.dead) return 0;

  const dealt = Math.max(0, Math.min(amount, stats.hp));
  stats.hp -= dealt;

  // Threat is scaled by the attacker's stance (e.g. Defensive +30%).
  ctx.world.get(target, ThreatTable)?.add(source, Math.round(dealt * threatMult));
  generateRage(ctx, source, dealt); // dealing damage builds rage
  generateRage(ctx, target, dealt); // taking damage builds rage

  enterCombat(ctx, source);
  enterCombat(ctx, target);
  interruptCast(ctx, target, "interrupted");

  if (stats.dead) {
    ctx.log.push("info", `${nameOf(ctx, target)} dies.`);
    onDeath(ctx, target);
  }
  return dealt;
}

interface StrikeOptions {
  multiplier: number;
  bonus: number;
  school: DamageSchool;
  critMultiplier: number;
  label: string;
}

/**
 * A weapon-based attack (auto-attack or weapon ability). Rolls the attack
 * table, applies armor mitigation to physical damage, and logs the outcome.
 */
export function meleeStrike(
  ctx: GameContext,
  source: EntityId,
  target: EntityId,
  opts: StrikeOptions,
): void {
  const srcStats = ctx.world.get(source, Stats);
  const tgtStats = ctx.world.get(target, Stats);
  if (!srcStats || !tgtStats || tgtStats.dead) return;

  enterCombat(ctx, source);
  enterCombat(ctx, target);

  const outcome = rollAttackTable(ctx, source);
  if (outcome === "miss") {
    ctx.log.push("miss", logMiss(ctx, source, target, opts.label));
    return;
  }
  if (outcome === "dodge") {
    ctx.log.push(
      "miss",
      `${nameOf(ctx, target)} dodges ${possLow(ctx, source)} ${opts.label}.`,
    );
    return;
  }

  let raw = randInt(srcStats.weaponMinDamage, srcStats.weaponMaxDamage) * opts.multiplier + opts.bonus;
  const crit = outcome === "crit";
  if (crit) raw *= opts.critMultiplier;

  applyResolvedDamage(ctx, source, target, raw, opts.school, crit, opts.label);
}

interface SpellStrikeOptions {
  min: number;
  max: number;
  school: DamageSchool;
  critMultiplier: number;
  label: string;
}

/**
 * A direct spell hit. Rolls damage in [min, max], may crit (using the caster's
 * crit chance), and bypasses the melee miss/dodge table. Non-physical schools
 * ignore armor.
 */
export function spellStrike(
  ctx: GameContext,
  source: EntityId,
  target: EntityId,
  opts: SpellStrikeOptions,
): void {
  const srcStats = ctx.world.get(source, Stats);
  const tgtStats = ctx.world.get(target, Stats);
  if (!srcStats || !tgtStats || tgtStats.dead) return;

  let raw = randInt(opts.min, opts.max);
  const critChance = spellCritChance(ctx.world, source, opts.school === "physical");
  const crit = Math.random() * 100 < critChance;
  if (crit) raw *= opts.critMultiplier;

  applyResolvedDamage(ctx, source, target, raw, opts.school, crit, opts.label);
}

/**
 * Shared tail of melee/spell strikes. Stance modifiers are applied here, right
 * before mitigation and threat: the attacker's stance scales outgoing damage
 * and threat; the defender's stance scales incoming damage; armor (talent
 * scaled) then mitigates physical damage.
 */
function applyResolvedDamage(
  ctx: GameContext,
  source: EntityId,
  target: EntityId,
  raw: number,
  school: DamageSchool,
  crit: boolean,
  label: string,
): void {
  const attackerStance = stanceMultipliers(ctx.world, source);
  const defenderStance = stanceMultipliers(ctx.world, target);

  // Attacker stance scales outgoing damage before any mitigation.
  const outgoing = raw * attackerStance.damageDealt;

  // Armor mitigation (physical only). Armor is already gear/talent-scaled by
  // recalculateStats(), so the engine reads it straight off Stats.
  const targetArmor = ctx.world.get(target, Stats)?.armor ?? 0;
  const reduction = school === "physical" ? armorReduction(targetArmor) : 0;
  const blocked = Math.round(outgoing * reduction);
  const afterArmor = outgoing - blocked;

  // Defender stance reduces what actually lands (e.g. Defensive -10%).
  const final = Math.max(0, Math.round(afterArmor * defenderStance.damageTaken));

  const dealt = inflict(ctx, source, target, final, school, attackerStance.threat);
  ctx.log.push(
    crit ? "crit" : "damage",
    logHit(ctx, source, target, label, dealt, school, crit, blocked),
    school,
  );
}

// ---------------------------------------------------------------------------
// Combat-log line builders
// ---------------------------------------------------------------------------

function logHit(
  ctx: GameContext,
  source: EntityId,
  target: EntityId,
  label: string,
  dealt: number,
  school: DamageSchool,
  crit: boolean,
  blocked: number,
): string {
  const blockedText = blocked > 0 ? ` (${blocked} blocked by Armor)` : "";
  const poss = possCap(ctx, source);
  const tgt = nameOf(ctx, target);
  const dmg = `${dealt} ${capitalize(school)} damage`;
  return crit
    ? `${poss} ${label} CRITS ${tgt} for ${dmg}!${blockedText}`
    : `${poss} ${label} hits ${tgt} for ${dmg}${blockedText}.`;
}

function logMiss(
  ctx: GameContext,
  source: EntityId,
  target: EntityId,
  label: string,
): string {
  return isPlayer(ctx, source)
    ? `Your ${label} missed!`
    : `${nameOf(ctx, source)}'s ${label} misses ${nameOf(ctx, target)}.`;
}

// ---------------------------------------------------------------------------
// Resource helpers
// ---------------------------------------------------------------------------

function currentResource(ctx: GameContext, id: EntityId, type: string): number {
  if (type === "health") return ctx.world.get(id, Stats)?.hp ?? 0;
  const power = ctx.world.get(id, Power);
  return power && power.type === type ? power.current : 0;
}

function spendResource(ctx: GameContext, id: EntityId, type: string, amount: number): void {
  if (type === "health") {
    const stats = ctx.world.get(id, Stats);
    if (stats) stats.hp -= amount;
    return;
  }
  const power = ctx.world.get(id, Power);
  if (power && power.type === type) power.current = Math.max(0, power.current - amount);
}

// ---------------------------------------------------------------------------
// Spell casting
// ---------------------------------------------------------------------------

/**
 * Validate and begin casting a spell. Instant spells resolve immediately;
 * timed spells start a cast bar. Returns an error string, or null on success.
 */
export function tryStartCast(
  ctx: GameContext,
  caster: EntityId,
  spellId: string,
): string | null {
  const spell = getSpell(spellId);
  if (!spell) return "Unknown spell.";

  const combat = ctx.world.get(caster, Combat);
  const stats = ctx.world.get(caster, Stats);
  if (!combat || !stats) return "Caster cannot cast.";
  if (stats.dead) return "You are dead.";
  if (combat.cast) return "Already casting.";
  if (ctx.now < combat.gcdEndsAt) return "Global cooldown not ready.";

  // Every current ability is offensive: require a valid, in-range target.
  if (combat.targetId == null) return "You have no target.";
  if (!ctx.world.exists(combat.targetId)) return "Invalid target.";
  if (distance(ctx.world, caster, combat.targetId) > spell.range) {
    return "Target is out of range.";
  }

  if (currentResource(ctx, caster, spell.cost.type) < spell.cost.amount) {
    return `Not enough ${spell.cost.type}.`;
  }

  if (spell.triggersGcd) combat.gcdEndsAt = ctx.now + GCD_MS;

  // Talents (e.g. Improved Fireball) can shorten the cast before it starts.
  const castTime = effectiveCastTime(ctx.world, caster, spellId);
  if (castTime <= 0) {
    resolveSpell(ctx, caster, spellId);
  } else {
    combat.cast = new ActiveCast(spell.id, spell.name, castTime);
    ctx.log.push("cast", `${nameOf(ctx, caster)} begins to cast ${spell.name}.`);
  }
  return null;
}

/** Spend the resource and apply a spell's damage through the combat matrix. */
export function resolveSpell(
  ctx: GameContext,
  caster: EntityId,
  spellId: string,
): void {
  const spell = getSpell(spellId);
  const combat = ctx.world.get(caster, Combat);
  if (!spell || !combat) return;

  if (currentResource(ctx, caster, spell.cost.type) < spell.cost.amount) {
    ctx.log.push(
      "info",
      `${possCap(ctx, caster)} ${spell.name} fizzles: not enough ${spell.cost.type}.`,
    );
    return;
  }
  spendResource(ctx, caster, spell.cost.type, spell.cost.amount);

  const target = combat.targetId;
  if (target == null || !ctx.world.exists(target)) return;

  const effect = spell.effect;
  if (effect.kind === "weapon") {
    meleeStrike(ctx, caster, target, {
      multiplier: effect.multiplier,
      bonus: effect.bonus,
      school: effect.school,
      critMultiplier: effect.critMultiplier,
      label: spell.name,
    });
  } else {
    spellStrike(ctx, caster, target, {
      min: effect.min,
      max: effect.max,
      school: effect.school,
      critMultiplier: effect.critMultiplier,
      label: spell.name,
    });
  }
}

/** Clean up references to a dead entity, then roll its loot table. */
function onDeath(ctx: GameContext, dead: EntityId): void {
  for (const id of ctx.world.entities()) {
    const combat = ctx.world.get(id, Combat);
    if (combat?.targetId === dead) {
      combat.targetId = null;
      combat.autoAttacking = false;
      combat.inCombat = false;
    }
    ctx.world.get(id, ThreatTable)?.remove(dead);
  }

  // Roll the loot table (each entry independently) and create a corpse.
  const table = ctx.world.get(dead, LootTable);
  if (table) {
    const loot: string[] = [];
    for (const entry of table.entries) {
      if (Math.random() < entry.chance) loot.push(entry.itemId);
    }
    ctx.world.add(dead, new Corpse(loot, ctx.now + MONSTER_RESPAWN_MS));
    if (loot.length > 0) {
      ctx.log.push("info", `${nameOf(ctx, dead)} can be looted.`);
    }
  }
}
