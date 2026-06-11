/**
 * The authoritative game simulation: owns the ECS world, runs the fixed-step
 * system pipeline, applies player commands and serializes world snapshots.
 */

import {
  type EntitySnapshot,
  type CombatLogEvent,
} from "@wow/shared";
import { World, type EntityId } from "../ecs/World.js";
import {
  Combat,
  Identity,
  MonsterAI,
  MoveIntent,
  Position,
  Stats,
  ThreatTable,
} from "../ecs/components.js";
import { CombatLog, type GameContext, type System } from "./context.js";
import { tryStartCast } from "./combat.js";
import { CastingSystem } from "./systems/CastingSystem.js";
import { AutoAttackSystem } from "./systems/AutoAttackSystem.js";
import { MonsterAISystem } from "./systems/MonsterAISystem.js";
import { MovementSystem } from "./systems/MovementSystem.js";
import { RegenSystem } from "./systems/RegenSystem.js";

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
      new RegenSystem(),
    ];
  }

  // -- Spawning -------------------------------------------------------------

  spawnPlayer(name: string): EntityId {
    const id = this.world.createEntity();
    this.world.add(id, new Identity(name, "player"));
    this.world.add(id, new Position(0, 0));
    this.world.add(id, new Stats(100, 100, 100, 100, /*hpRegen*/ 6, /*manaRegen*/ 8));
    this.world.add(id, new Combat(/*weaponDamage*/ 15));
    this.world.add(id, new MoveIntent());
    this.log.push("info", `${name} has entered the world.`);
    return id;
  }

  spawnTargetDummy(name: string, x: number, y: number): EntityId {
    const id = this.world.createEntity();
    this.world.add(id, new Identity(name, "monster"));
    this.world.add(id, new Position(x, y));
    this.world.add(id, new Stats(1000, 1000, 0, 0));
    this.world.add(id, new Combat(/*weaponDamage*/ 4));
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
      out.push({
        id,
        kind: ident.kind,
        name: ident.name,
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        hp: Math.round(stats.hp),
        maxHp: stats.maxHp,
        mana: Math.round(stats.mana),
        maxMana: stats.maxMana,
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
