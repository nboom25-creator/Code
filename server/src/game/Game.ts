/**
 * The authoritative game simulation: owns the ECS world, runs the fixed-step
 * system pipeline, applies player commands and serializes world snapshots.
 */

import {
  HP_REGEN_PER_SEC,
  PROFILES,
  type ClassProfile,
  type CombatLogEvent,
  type EntitySnapshot,
} from "@wow/shared";
import { World, type EntityId } from "../ecs/World.js";
import {
  Combat,
  Identity,
  MonsterAI,
  MoveIntent,
  Position,
  Power,
  Stats,
  ThreatTable,
} from "../ecs/components.js";
import { CombatLog, type GameContext, type System } from "./context.js";
import { tryStartCast } from "./combat.js";
import { CastingSystem } from "./systems/CastingSystem.js";
import { AutoAttackSystem } from "./systems/AutoAttackSystem.js";
import { MonsterAISystem } from "./systems/MonsterAISystem.js";
import { MovementSystem } from "./systems/MovementSystem.js";
import { ResourceSystem } from "./systems/ResourceSystem.js";

/** Default class profile a freshly-spawned player starts with. */
const DEFAULT_PROFILE: ClassProfile = "mage";

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

  spawnPlayer(name: string): EntityId {
    const id = this.world.createEntity();
    this.world.add(id, new Identity(name, "player"));
    this.world.add(id, new Position(0, 0));
    this.world.add(
      id,
      new Stats(
        /*hp*/ 100,
        /*maxHp*/ 100,
        { strength: 20, agility: 20, intellect: 20, stamina: 20 },
        /*armor*/ 30,
        /*weaponMin*/ 8,
        /*weaponMax*/ 12,
        /*critChance*/ 15,
        /*hpRegen*/ HP_REGEN_PER_SEC,
      ),
    );
    const profile = PROFILES[DEFAULT_PROFILE];
    this.world.add(id, new Power(profile.power, profile.start, profile.max, profile.manaRegen));
    this.world.add(id, new Combat());
    this.world.add(id, new MoveIntent());
    this.log.push("info", `${name} has entered the world as a ${profile.label}.`);
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

  /** Swap the player's class profile, reseeding the active resource. */
  setResourceProfile(player: EntityId, profileId: ClassProfile): void {
    const profile = PROFILES[profileId];
    if (!profile) return;
    let power = this.world.get(player, Power);
    if (!power) {
      power = this.world.add(player, new Power(profile.power, profile.start, profile.max, profile.manaRegen));
    } else {
      power.type = profile.power;
      power.current = profile.start;
      power.max = profile.max;
      power.manaRegen = profile.manaRegen;
      power.tickAccumulator = 0;
    }
    const name = this.world.get(player, Identity)?.name ?? "You";
    this.log.push("info", `${name} switches to the ${profile.label} profile (${profile.power}).`);
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

  snapshot(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const id of this.world.query(Identity, Position, Stats, Combat)) {
      const ident = this.world.get(id, Identity)!;
      const pos = this.world.get(id, Position)!;
      const stats = this.world.get(id, Stats)!;
      const combat = this.world.get(id, Combat)!;
      const power = this.world.get(id, Power);
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
