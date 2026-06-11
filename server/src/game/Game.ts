/**
 * The authoritative game simulation: owns the ECS world, runs the fixed-step
 * system pipeline, applies player commands and serializes world snapshots.
 */

import {
  STANCE_COOLDOWN_MS,
  STARTING_TALENT_POINTS,
  getClass,
  getTalent,
  pointsSpent,
  type ClassId,
  type CombatLogEvent,
  type EntitySnapshot,
  type TalentState,
} from "@wow/shared";
import { World, type EntityId } from "../ecs/World.js";
import {
  ClassState,
  Combat,
  Identity,
  MonsterAI,
  MoveIntent,
  Position,
  Power,
  Stats,
  Talents,
  ThreatTable,
} from "../ecs/components.js";
import { CombatLog, type GameContext, type System } from "./context.js";
import { tryStartCast } from "./combat.js";
import { CastingSystem } from "./systems/CastingSystem.js";
import { AutoAttackSystem } from "./systems/AutoAttackSystem.js";
import { MonsterAISystem } from "./systems/MonsterAISystem.js";
import { MovementSystem } from "./systems/MovementSystem.js";
import { ResourceSystem } from "./systems/ResourceSystem.js";

/** Class a freshly-spawned player is instantiated as. */
const DEFAULT_CLASS: ClassId = "mage";

export class Game {
  readonly world = new World();
  private readonly log = new CombatLog();
  private readonly systems: System[];
  private lastTick = Date.now();

  constructor() {
    // Order matters: move/AI decide intent, casting & swings resolve, regen last.
    this.systems = [
      new MovementSystem(),
      new MonsterAISystem(),
      new CastingSystem(),
      new AutoAttackSystem(),
      new ResourceSystem(),
    ];
  }

  // -- Spawning -------------------------------------------------------------

  /** Apply a class's base stats, resource and default stance to an entity. */
  private instantiateClass(id: EntityId, classId: ClassId): void {
    const def = getClass(classId);
    const b = def.base;
    this.world.add(
      id,
      new Stats(
        b.hp,
        b.hp,
        { strength: b.strength, agility: b.agility, intellect: b.intellect, stamina: b.stamina },
        b.armor,
        b.weaponMin,
        b.weaponMax,
        b.critChance,
        b.hpRegen,
      ),
    );
    this.world.add(id, new Power(def.power, def.powerStart, def.powerMax, def.manaRegen));
    this.world.add(id, new ClassState(def.id, def.stances[0].id));
  }

  spawnPlayer(name: string): EntityId {
    const id = this.world.createEntity();
    this.world.add(id, new Identity(name, "player"));
    this.world.add(id, new Position(0, 0));
    this.instantiateClass(id, DEFAULT_CLASS);
    this.world.add(id, new Talents({}, STARTING_TALENT_POINTS));
    this.world.add(id, new Combat());
    this.world.add(id, new MoveIntent());
    this.log.push("info", `${name} has entered the world as a ${getClass(DEFAULT_CLASS).name}.`);
    return id;
  }

  spawnTargetDummy(name: string, x: number, y: number): EntityId {
    const id = this.world.createEntity();
    this.world.add(id, new Identity(name, "monster"));
    this.world.add(id, new Position(x, y));
    this.world.add(
      id,
      new Stats(
        /*hp*/ 1000,
        /*maxHp*/ 1000,
        { strength: 10, agility: 10, intellect: 10, stamina: 10 },
        /*armor*/ 150,
        /*weaponMin*/ 3,
        /*weaponMax*/ 5,
        /*critChance*/ 0,
        /*hpRegen*/ 0,
      ),
    );
    this.world.add(id, new Combat());
    this.world.add(id, new ThreatTable());
    // Non-passive: swings back lightly so cast interrupts can be demonstrated.
    this.world.add(id, new MonsterAI(/*passive*/ false));
    return id;
  }

  // -- Command handling -----------------------------------------------------

  setTarget(player: EntityId, targetId: EntityId | null): void {
    const combat = this.world.get(player, Combat);
    if (!combat) return;
    if (targetId !== null && !this.world.exists(targetId)) return;
    combat.targetId = targetId;
  }

  toggleAutoAttack(player: EntityId): void {
    const combat = this.world.get(player, Combat);
    if (!combat) return;
    combat.autoAttacking = !combat.autoAttacking;
    if (combat.autoAttacking) {
      combat.inCombat = true;
      const name = this.world.get(player, Identity)?.name ?? "You";
      this.log.push("info", `${name} starts attacking.`);
    } else {
      this.log.push("info", `Auto-attack disabled.`);
    }
  }

  castSpell(player: EntityId, spellId: string): void {
    const error = tryStartCast(this.ctx(), player, spellId);
    if (error) this.log.push("info", error);
  }

  /** Instantiate the player as a class, locking in its resource type. */
  setClass(player: EntityId, classId: ClassId): void {
    if (!this.world.exists(player) || !getClass(classId)) return;
    this.instantiateClass(player, classId); // resets Stats / Power / stance
    const combat = this.world.get(player, Combat);
    if (combat) combat.cast = null;
    const def = getClass(classId);
    const name = this.world.get(player, Identity)?.name ?? "You";
    this.log.push("info", `${name} becomes a ${def.name} (${def.power}).`);
  }

  /** Switch the active stance/form, gated by the stance cooldown. */
  setStance(player: EntityId, stanceId: string, now = Date.now()): void {
    const cls = this.world.get(player, ClassState);
    if (!cls) return;
    const def = getClass(cls.classId);
    const stance = def.stances.find((s) => s.id === stanceId);
    if (!stance) {
      this.log.push("info", "That stance is not available to your class.");
      return;
    }
    if (cls.stanceId === stanceId) return;
    if (now < cls.stanceCdEndsAt) {
      this.log.push("info", "Stance not ready.");
      return;
    }
    cls.stanceId = stanceId;
    cls.stanceCdEndsAt = now + STANCE_COOLDOWN_MS;
    const name = this.world.get(player, Identity)?.name ?? "You";
    this.log.push("info", `${name} switches to ${stance.name}.`);
  }

  /** Spend one talent point in a talent, if budget and rank allow. */
  spendTalent(player: EntityId, talentId: string): void {
    const talents = this.world.get(player, Talents);
    const talent = getTalent(talentId);
    if (!talents || !talent) return;
    const current = talents.ranks[talentId] ?? 0;
    if (current >= talent.maxRank) {
      this.log.push("info", `${talent.name} is already at max rank.`);
      return;
    }
    if (pointsSpent(talents.ranks) >= talents.pointsTotal) {
      this.log.push("info", "No talent points available.");
      return;
    }
    talents.ranks[talentId] = current + 1;
    this.log.push("info", `Learned ${talent.name} (rank ${current + 1}/${talent.maxRank}).`);
  }

  /** Refund all spent talent points. */
  resetTalents(player: EntityId): void {
    const talents = this.world.get(player, Talents);
    if (!talents) return;
    talents.ranks = {};
    this.log.push("info", "Talents reset.");
  }

  setMoveIntent(player: EntityId, dx: number, dy: number): void {
    const intent = this.world.get(player, MoveIntent);
    if (intent) {
      intent.dx = dx;
      intent.dy = dy;
    }
  }

  removePlayer(player: EntityId): void {
    const name = this.world.get(player, Identity)?.name;
    this.world.destroyEntity(player);
    // Clear the departed player from every threat table.
    for (const id of this.world.query(ThreatTable)) {
      this.world.get(id, ThreatTable)!.remove(player);
    }
    if (name) this.log.push("info", `${name} has left the world.`);
  }

  // -- Tick -----------------------------------------------------------------

  tick(now = Date.now()): void {
    const dt = Math.min((now - this.lastTick) / 1000, 0.25); // clamp long pauses
    this.lastTick = now;
    const ctx: GameContext = { world: this.world, now, dt, log: this.log };
    for (const system of this.systems) system.update(ctx);
  }

  private ctx(now = Date.now()): GameContext {
    return { world: this.world, now, dt: 0, log: this.log };
  }

  // -- Serialization --------------------------------------------------------

  drainLog(): CombatLogEvent[] {
    return this.log.drain();
  }

  /** Remaining GCD (ms) for a given player, for the client's button sweep. */
  gcdRemaining(player: EntityId, now = Date.now()): number {
    const combat = this.world.get(player, Combat);
    if (!combat) return 0;
    return Math.max(0, combat.gcdEndsAt - now);
  }

  /** Remaining stance-swap cooldown (ms) for a player. */
  stanceCdRemaining(player: EntityId, now = Date.now()): number {
    const cls = this.world.get(player, ClassState);
    if (!cls) return 0;
    return Math.max(0, cls.stanceCdEndsAt - now);
  }

  /** The player's talent allocation, serialized for the client panel. */
  talentState(player: EntityId): TalentState {
    const talents = this.world.get(player, Talents);
    if (!talents) return { ranks: {}, pointsTotal: 0, pointsSpent: 0 };
    return {
      ranks: { ...talents.ranks },
      pointsTotal: talents.pointsTotal,
      pointsSpent: pointsSpent(talents.ranks),
    };
  }

  snapshot(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const id of this.world.query(Identity, Position, Stats, Combat)) {
      const ident = this.world.get(id, Identity)!;
      const pos = this.world.get(id, Position)!;
      const stats = this.world.get(id, Stats)!;
      const combat = this.world.get(id, Combat)!;
      const power = this.world.get(id, Power);
      const cls = this.world.get(id, ClassState);
      out.push({
        id,
        kind: ident.kind,
        name: ident.name,
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        hp: Math.round(stats.hp),
        maxHp: stats.maxHp,
        power: power ? Math.floor(power.current) : 0,
        maxPower: power ? power.max : 0,
        powerType: power ? power.type : "mana",
        classId: cls ? cls.classId : null,
        stanceId: cls ? cls.stanceId : "neutral",
        inCombat: combat.inCombat,
        targetId: combat.targetId,
        autoAttacking: combat.autoAttacking,
        cast: combat.cast
          ? {
              spellId: combat.cast.spellId,
              spellName: combat.cast.spellName,
              total: combat.cast.castTime,
              elapsed: Math.min(combat.cast.elapsed, combat.cast.castTime),
            }
          : null,
      });
    }
    return out;
  }
}
