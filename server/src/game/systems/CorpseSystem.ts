/**
 * Respawns slain monsters once their corpse timer elapses, restoring full HP
 * and clearing combat/threat state so the training dummy is endlessly farmable.
 */

import { Combat, Corpse, Identity, Stats, ThreatTable } from "../../ecs/components.js";
import type { System, GameContext } from "../context.js";

export class CorpseSystem implements System {
  readonly name = "CorpseSystem";

  update(ctx: GameContext): void {
    for (const id of ctx.world.query(Corpse)) {
      const corpse = ctx.world.get(id, Corpse)!;
      if (ctx.now < corpse.respawnAt) continue;

      const stats = ctx.world.get(id, Stats);
      if (stats) stats.hp = stats.maxHp;

      const combat = ctx.world.get(id, Combat);
      if (combat) {
        combat.inCombat = false;
        combat.targetId = null;
        combat.autoAttacking = false;
        combat.cast = null;
      }
      ctx.world.get(id, ThreatTable)?.threat.clear();
      ctx.world.remove(id, Corpse);

      const name = ctx.world.get(id, Identity)?.name ?? `Entity#${id}`;
      ctx.log.push("info", `${name} returns, refreshed.`);
    }
  }
}
