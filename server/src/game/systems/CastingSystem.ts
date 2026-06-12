/**
 * Advances active cast bars and resolves spells when their cast time elapses.
 * Cast cancellation (movement, damage) is handled where those events occur in
 * `combat.ts`; this system only drives forward progress and completion.
 */

import { Combat, Identity } from "../../ecs/components.js";
import type { System, GameContext } from "../context.js";
import { resolveSpell } from "../combat.js";

export class CastingSystem implements System {
  readonly name = "CastingSystem";

  update(ctx: GameContext): void {
    for (const id of ctx.world.query(Combat)) {
      const combat = ctx.world.get(id, Combat)!;
      const cast = combat.cast;
      if (!cast) continue;

      cast.elapsed += ctx.dt * 1000;
      if (cast.elapsed >= cast.castTime) {
        const name = ctx.world.get(id, Identity)?.name ?? `Entity#${id}`;
        combat.cast = null;
        ctx.log.push("cast", `${name} finishes casting ${cast.spellName}.`);
        resolveSpell(ctx, id, cast.spellId);
      }
    }
  }
}
