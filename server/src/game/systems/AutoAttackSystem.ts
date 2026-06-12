/**
 * Drives the auto-attack weapon swing loop. While an entity is in combat, has
 * auto-attack enabled, and its target is within melee range, it lands a weapon
 * swing every SWING_TIMER_MS — resolved through the full melee attack table.
 */

import { MELEE_RANGE, SWING_TIMER_MS } from "@wow/shared";
import { Combat, Stats } from "../../ecs/components.js";
import type { System, GameContext } from "../context.js";
import { meleeStrike } from "../combat.js";
import { distance } from "../util.js";

export class AutoAttackSystem implements System {
  readonly name = "AutoAttackSystem";

  update(ctx: GameContext): void {
    for (const id of ctx.world.query(Combat)) {
      const combat = ctx.world.get(id, Combat)!;

      if (!combat.autoAttacking || combat.targetId == null) continue;
      if (!ctx.world.exists(combat.targetId)) {
        combat.targetId = null;
        continue;
      }
      const targetStats = ctx.world.get(combat.targetId, Stats);
      if (!targetStats || targetStats.dead) continue;

      // Out of range: hold the swing (timer does not advance), like WoW.
      if (distance(ctx.world, id, combat.targetId) > MELEE_RANGE) continue;

      combat.swingTimer -= ctx.dt * 1000;
      if (combat.swingTimer <= 0) {
        meleeStrike(ctx, id, combat.targetId, {
          multiplier: 1,
          bonus: 0,
          school: "physical",
          critMultiplier: 2.0,
          label: "auto attack",
        });
        combat.swingTimer = SWING_TIMER_MS;
      }
    }
  }
}
