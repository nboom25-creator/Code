/**
 * Monster targeting AI. Each monster targets whoever sits highest on its
 * ThreatTable. Non-passive monsters then enable auto-attack against that
 * target (the AutoAttackSystem performs the swings); passive target dummies
 * acquire a target for display but never retaliate.
 */

import { Combat, MonsterAI, ThreatTable } from "../../ecs/components.js";
import type { System, GameContext } from "../context.js";
import { enterCombat } from "../combat.js";

export class MonsterAISystem implements System {
  readonly name = "MonsterAISystem";

  update(ctx: GameContext): void {
    for (const id of ctx.world.query(MonsterAI, Combat, ThreatTable)) {
      const ai = ctx.world.get(id, MonsterAI)!;
      const combat = ctx.world.get(id, Combat)!;
      const threat = ctx.world.get(id, ThreatTable)!;

      const top = threat.highest();
      combat.targetId = top;

      if (top == null) {
        combat.inCombat = false;
        combat.autoAttacking = false;
        continue;
      }

      enterCombat(ctx, id);
      // Passive dummies acquire a target but never swing back.
      combat.autoAttacking = !ai.passive;
    }
  }
}
