/**
 * Shared combat primitives used by the casting, auto-attack and AI systems.
 *
 * Centralising damage / resource / threat application here keeps the Classic
 * WoW rules in one place: damage always builds threat, taking damage cancels a
 * cast, and resources are spent when a cast resolves.
 */

import { getSpell, GCD_MS, type DamageSchool } from "@wow/shared";
import {
  ActiveCast,
  Combat,
  Identity,
  Stats,
  ThreatTable,
} from "../ecs/components.js";
import type { EntityId } from "../ecs/World.js";
import type { GameContext } from "./context.js";
import { distance } from "./util.js";

function nameOf(ctx: GameContext, id: EntityId): string {
  return ctx.world.get(id, Identity)?.name ?? `Entity#${id}`;
}

/** Put an entity into combat (starts auto-attack swing cadence elsewhere). */
export function enterCombat(ctx: GameContext, id: EntityId): void {
  const combat = ctx.world.get(id, Combat);
  if (combat && !combat.inCombat) {
    combat.inCombat = true;
    // Wind up the first swing so combat opens with an attack ~immediately.
    if (combat.swingTimer <= 0) combat.swingTimer = 0;
  }
}

/** Cancel an in-progress cast, logging the reason. */
export function interruptCast(
  ctx: GameContext,
  caster: EntityId,
  reason: string,
): void {
  const combat = ctx.world.get(caster, Combat);
  if (!combat?.cast) return;
  const spellName = combat.cast.spellName;
  combat.cast = null;
  ctx.log.push("cast", `${nameOf(ctx, caster)}'s ${spellName} was ${reason}.`);
}

/**
 * Apply damage from `source` to `target`. Builds threat, may interrupt the
 * target's cast, and handles death. Returns the damage actually dealt.
 */
export function applyDamage(
  ctx: GameContext,
  source: EntityId,
  target: EntityId,
  amount: number,
  school: DamageSchool,
  label: string,
): number {
  const stats = ctx.world.get(target, Stats);
  if (!stats || stats.dead) return 0;

  const dealt = Math.min(amount, stats.hp);
  stats.hp -= dealt;

  // Threat: the damage dealer climbs the target's threat table.
  ctx.world.get(target, ThreatTable)?.add(source, dealt);

  enterCombat(ctx, source);
  enterCombat(ctx, target);

  // Taking damage cancels the victim's cast (pushback -> full interrupt here).
  interruptCast(ctx, target, "interrupted");

  const isPlayerSource = ctx.world.get(source, Identity)?.kind === "player";
  const sourceName = nameOf(ctx, source);
  const targetName = nameOf(ctx, target);
  const verb = isPlayerSource ? "Your" : `${sourceName}'s`;
  ctx.log.push(
    "damage",
    `${verb} ${label} hit ${targetName} for ${dealt} ${capitalize(school)} damage.`,
    school,
  );

  if (stats.dead) {
    ctx.log.push("info", `${targetName} dies.`);
    onDeath(ctx, target);
  }
  return dealt;
}

/** Restore a resource to an entity, clamped to its maximum. */
export function applyRestore(
  ctx: GameContext,
  target: EntityId,
  type: "health" | "mana",
  amount: number,
): void {
  const stats = ctx.world.get(target, Stats);
  if (!stats) return;
  if (type === "mana") {
    stats.mana = Math.min(stats.maxMana, stats.mana + amount);
  } else {
    stats.hp = Math.min(stats.maxHp, stats.hp + amount);
  }
  ctx.log.push(
    "resource",
    `${nameOf(ctx, target)} gains ${amount} ${type === "mana" ? "Mana" : "Health"}.`,
  );
}

function currentResource(stats: Stats, type: "health" | "mana"): number {
  return type === "mana" ? stats.mana : stats.hp;
}
function spendResource(stats: Stats, type: "health" | "mana", amt: number): void {
  if (type === "mana") stats.mana -= amt;
  else stats.hp -= amt;
}

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

  // Targeting / range checks for offensive spells.
  if (spell.effect.damage) {
    if (combat.targetId == null) return "You have no target.";
    if (!ctx.world.exists(combat.targetId)) return "Invalid target.";
    if (distance(ctx.world, caster, combat.targetId) > spell.range) {
      return "Target is out of range.";
    }
  }

  if (currentResource(stats, spell.cost.type) < spell.cost.amount) {
    return `Not enough ${spell.cost.type}.`;
  }

  // Trigger the GCD at cast start (Classic behaviour).
  if (spell.triggersGcd) combat.gcdEndsAt = ctx.now + GCD_MS;

  if (spell.castTime <= 0) {
    resolveSpell(ctx, caster, spellId);
  } else {
    combat.cast = new ActiveCast(spell.id, spell.name, spell.castTime);
    ctx.log.push("cast", `${nameOf(ctx, caster)} begins to cast ${spell.name}.`);
  }
  return null;
}

/** Apply a spell's effects (resource cost + damage / restore). */
export function resolveSpell(
  ctx: GameContext,
  caster: EntityId,
  spellId: string,
): void {
  const spell = getSpell(spellId);
  const stats = ctx.world.get(caster, Stats);
  const combat = ctx.world.get(caster, Combat);
  if (!spell || !stats || !combat) return;

  // Re-validate resource at resolution time (it may have changed mid-cast).
  if (currentResource(stats, spell.cost.type) < spell.cost.amount) {
    ctx.log.push("info", `${nameOf(ctx, caster)} fails to cast ${spell.name}: not enough ${spell.cost.type}.`);
    return;
  }
  spendResource(stats, spell.cost.type, spell.cost.amount);

  if (spell.effect.damage && combat.targetId != null) {
    applyDamage(
      ctx,
      caster,
      combat.targetId,
      spell.effect.damage,
      spell.effect.damageSchool ?? "physical",
      spell.name,
    );
  }
  if (spell.effect.restore) {
    applyRestore(ctx, caster, spell.effect.restore.type, spell.effect.restore.amount);
  }
}

/** Clean up references to a dead entity (drop it as everyone's target). */
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
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
