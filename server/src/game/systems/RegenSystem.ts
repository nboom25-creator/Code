/**
 * Passive resource regeneration. Mana regenerates continuously; health only
 * regenerates while out of combat (a simplified "five second rule").
 */

import { Combat, Stats } from "../../ecs/components.js";
import type { System, GameContext } from "../context.js";

export class RegenSystem implements System {
  readonly name = "RegenSystem";

  update(ctx: GameContext): void {
    for (const id of ctx.world.query(Stats)) {
      const stats = ctx.world.get(id, Stats)!;
      if (stats.dead) continue;
      const combat = ctx.world.get(id, Combat);

      if (stats.manaRegen > 0 && stats.mana < stats.maxMana) {
        stats.mana = Math.min(stats.maxMana, stats.mana + stats.manaRegen * ctx.dt);
      }
      const inCombat = combat?.inCombat ?? false;
      if (!inCombat && stats.hpRegen > 0 && stats.hp < stats.maxHp) {
        stats.hp = Math.min(stats.maxHp, stats.hp + stats.hpRegen * ctx.dt);
      }
    }
  }
}
