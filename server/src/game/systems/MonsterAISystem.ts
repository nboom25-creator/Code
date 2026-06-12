/**
 * Monster AI state machine: IDLE / PATROL / CHASE / EVADE.
 *
 * All navigation, distance checks and leashing run here on the server heartbeat
 * so players cannot kite a monster infinitely — once it strays too far from its
 * HomePosition it leashes, wipes threat, and evades home at high speed while
 * immune to damage (the immunity itself is enforced in combat.ts).
 */

import {
  AGGRO_RADIUS,
  CHASE_SPEED_MULT,
  EVADE_HEAL_PER_SEC,
  EVADE_SPEED_MULT,
  HOME_ARRIVE_EPSILON,
  LEASH_RANGE,
  MELEE_RANGE,
  MONSTER_WALK_SPEED,
  SOCIAL_RADIUS,
} from "@wow/shared";
import {
  Combat,
  Corpse,
  Identity,
  Locomotion,
  MonsterAI,
  MoveIntent,
  Position,
  Stats,
  ThreatTable,
} from "../../ecs/components.js";
import type { System, GameContext } from "../context.js";
import type { EntityId } from "../../ecs/World.js";

const PATROL_ARRIVE = 4;

export class MonsterAISystem implements System {
  readonly name = "MonsterAISystem";

  update(ctx: GameContext): void {
    for (const id of ctx.world.query(MonsterAI, Position, Combat, ThreatTable)) {
      // Dead monsters are handled by the CorpseSystem, not the AI.
      if (ctx.world.get(id, Corpse) || ctx.world.get(id, Stats)?.dead) continue;

      const ai = ctx.world.get(id, MonsterAI)!;
      switch (ai.state) {
        case "evade":
          this.updateEvade(ctx, id, ai);
          break;
        case "chase":
          this.updateChase(ctx, id, ai);
          break;
        default:
          this.updatePatrol(ctx, id, ai);
          break;
      }
    }
  }

  // -- PATROL / IDLE --------------------------------------------------------

  private updatePatrol(ctx: GameContext, id: EntityId, ai: MonsterAI): void {
    const combat = ctx.world.get(id, Combat)!;
    const threat = ctx.world.get(id, ThreatTable)!;

    // Acquire a target: existing threat (was attacked) or a nearby player.
    let target = threat.highest();
    let proximityPull = false;
    if (target == null) {
      target = this.nearestPlayerWithin(ctx, id, AGGRO_RADIUS);
      if (target != null) {
        threat.add(target, 1); // proximity grants 1 threat
        proximityPull = true;
      }
    }

    if (target != null) {
      this.enterChase(ctx, id, ai, target);
      if (proximityPull) {
        ctx.log.push("info", `${name(ctx, id)} yells: You'll regret coming here!`);
      }
      this.socialPull(ctx, id, target);
      return;
    }

    // No target: wander the patrol line at walking speed.
    this.setSpeed(ctx, id, MONSTER_WALK_SPEED);
    combat.inCombat = false;
    combat.autoAttacking = false;
    combat.targetId = null;

    const a = { x: ai.patrolAx, y: ai.patrolAy };
    const b = { x: ai.patrolBx, y: ai.patrolBy };
    if (dist2(a, b) < 1) {
      ai.state = "idle";
      this.stop(ctx, id);
      return;
    }
    ai.state = "patrol";
    const goal = ai.patrolToB ? b : a;
    const pos = ctx.world.get(id, Position)!;
    if (Math.hypot(goal.x - pos.x, goal.y - pos.y) <= PATROL_ARRIVE) {
      ai.patrolToB = !ai.patrolToB;
    }
    this.steerToward(ctx, id, goal.x, goal.y);
  }

  // -- CHASE ----------------------------------------------------------------

  private updateChase(ctx: GameContext, id: EntityId, ai: MonsterAI): void {
    const pos = ctx.world.get(id, Position)!;
    const combat = ctx.world.get(id, Combat)!;
    const threat = ctx.world.get(id, ThreatTable)!;

    // Leash: too far from home -> drop everything and evade back.
    if (Math.hypot(pos.x - ai.homeX, pos.y - ai.homeY) > LEASH_RANGE) {
      this.enterEvade(ctx, id, ai, "leash");
      return;
    }

    const target = threat.highest();
    const targetStats = target != null ? ctx.world.get(target, Stats) : undefined;
    if (target == null || !ctx.world.exists(target) || !targetStats || targetStats.dead) {
      // Lost the target (died / left) -> reset.
      this.enterEvade(ctx, id, ai, "reset");
      return;
    }

    this.setSpeed(ctx, id, MONSTER_WALK_SPEED * CHASE_SPEED_MULT);
    combat.inCombat = true;
    combat.autoAttacking = true;
    combat.targetId = target;

    const tpos = ctx.world.get(target, Position)!;
    if (Math.hypot(tpos.x - pos.x, tpos.y - pos.y) <= MELEE_RANGE) {
      this.stop(ctx, id); // in range: stand and let AutoAttackSystem swing
    } else {
      this.steerToward(ctx, id, tpos.x, tpos.y);
    }
  }

  // -- EVADE ----------------------------------------------------------------

  private updateEvade(ctx: GameContext, id: EntityId, ai: MonsterAI): void {
    const pos = ctx.world.get(id, Position)!;
    const stats = ctx.world.get(id, Stats);
    const combat = ctx.world.get(id, Combat)!;

    this.setSpeed(ctx, id, MONSTER_WALK_SPEED * EVADE_SPEED_MULT);
    combat.autoAttacking = false;
    combat.targetId = null;

    // Rapidly regenerate while running home.
    if (stats && stats.hp < stats.maxHp) {
      stats.hp = Math.min(stats.maxHp, stats.hp + stats.maxHp * EVADE_HEAL_PER_SEC * ctx.dt);
    }

    const home = Math.hypot(pos.x - ai.homeX, pos.y - ai.homeY);
    if (home <= HOME_ARRIVE_EPSILON) {
      if (stats) stats.hp = stats.maxHp;
      combat.inCombat = false;
      ai.state = "patrol";
      ai.patrolToB = true;
      this.stop(ctx, id);
      this.setSpeed(ctx, id, MONSTER_WALK_SPEED);
      ctx.log.push("info", `${name(ctx, id)} returns to its post, fully healed.`);
      return;
    }
    this.steerToward(ctx, id, ai.homeX, ai.homeY);
  }

  // -- Transitions ----------------------------------------------------------

  private enterChase(ctx: GameContext, id: EntityId, ai: MonsterAI, target: EntityId): void {
    ai.state = "chase";
    const combat = ctx.world.get(id, Combat)!;
    combat.inCombat = true;
    combat.autoAttacking = true;
    combat.targetId = target;
    this.setSpeed(ctx, id, MONSTER_WALK_SPEED * CHASE_SPEED_MULT);
  }

  private enterEvade(ctx: GameContext, id: EntityId, ai: MonsterAI, reason: "leash" | "reset"): void {
    ai.state = "evade";
    ctx.world.get(id, ThreatTable)?.threat.clear(); // drop the entire threat table
    const combat = ctx.world.get(id, Combat)!;
    combat.targetId = null;
    combat.autoAttacking = false;
    this.setSpeed(ctx, id, MONSTER_WALK_SPEED * EVADE_SPEED_MULT);
    const msg =
      reason === "leash"
        ? `${name(ctx, id)} evades and runs back to its camp.`
        : `${name(ctx, id)} loses interest and evades.`;
    ctx.log.push("info", msg);
  }

  /** Pull friendly monsters within SOCIAL_RADIUS into the fight. */
  private socialPull(ctx: GameContext, pullerId: EntityId, target: EntityId): void {
    const ppos = ctx.world.get(pullerId, Position)!;
    let pulled = false;
    for (const other of ctx.world.query(MonsterAI, Position, ThreatTable)) {
      if (other === pullerId) continue;
      if (ctx.world.get(other, Corpse) || ctx.world.get(other, Stats)?.dead) continue;
      const ai = ctx.world.get(other, MonsterAI)!;
      if (ai.state === "chase" || ai.state === "evade") continue; // already engaged
      const opos = ctx.world.get(other, Position)!;
      if (Math.hypot(opos.x - ppos.x, opos.y - ppos.y) > SOCIAL_RADIUS) continue;
      // Assist: gain threat so it engages the same player next tick.
      ctx.world.get(other, ThreatTable)!.add(target, 1);
      pulled = true;
    }
    if (pulled) {
      ctx.log.push("info", `${name(ctx, pullerId)} sounds the alarm!`);
    }
  }

  // -- Movement helpers -----------------------------------------------------

  private steerToward(ctx: GameContext, id: EntityId, x: number, y: number): void {
    const pos = ctx.world.get(id, Position)!;
    const intent = ctx.world.get(id, MoveIntent);
    if (intent) {
      intent.dx = x - pos.x;
      intent.dy = y - pos.y;
    }
  }

  private stop(ctx: GameContext, id: EntityId): void {
    const intent = ctx.world.get(id, MoveIntent);
    if (intent) {
      intent.dx = 0;
      intent.dy = 0;
    }
  }

  private setSpeed(ctx: GameContext, id: EntityId, speed: number): void {
    const loco = ctx.world.get(id, Locomotion);
    if (loco) loco.speed = speed;
  }

  private nearestPlayerWithin(ctx: GameContext, id: EntityId, radius: number): EntityId | null {
    const pos = ctx.world.get(id, Position)!;
    let best: EntityId | null = null;
    let bestDist = radius;
    for (const pid of ctx.world.query(Identity, Position, Stats)) {
      if (ctx.world.get(pid, Identity)!.kind !== "player") continue;
      if (ctx.world.get(pid, Stats)!.dead) continue;
      const ppos = ctx.world.get(pid, Position)!;
      const d = Math.hypot(ppos.x - pos.x, ppos.y - pos.y);
      if (d <= bestDist) {
        bestDist = d;
        best = pid;
      }
    }
    return best;
  }
}

function name(ctx: GameContext, id: EntityId): string {
  return ctx.world.get(id, Identity)?.name ?? `Entity#${id}`;
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
