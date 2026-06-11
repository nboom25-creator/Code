/**
 * Integrates movement intent into world position for any entity that has a
 * MoveIntent + Locomotion (players via input, monsters via their AI). Player
 * movement also cancels an in-progress cast — the Classic "moving interrupts
 * casting" rule.
 */

import { WORLD_HEIGHT, WORLD_WIDTH } from "@wow/shared";
import { Combat, Locomotion, MoveIntent, Position } from "../../ecs/components.js";
import type { System, GameContext } from "../context.js";
import { interruptCast } from "../combat.js";
import { clamp } from "../util.js";

export class MovementSystem implements System {
  readonly name = "MovementSystem";

  update(ctx: GameContext): void {
    for (const id of ctx.world.query(MoveIntent, Locomotion, Position)) {
      const intent = ctx.world.get(id, MoveIntent)!;
      const pos = ctx.world.get(id, Position)!;
      const speed = ctx.world.get(id, Locomotion)!.speed;

      const len = Math.hypot(intent.dx, intent.dy);
      if (len < 0.001) continue;

      const step = speed * ctx.dt;
      // World coordinates are centered on the origin (0,0).
      pos.x = clamp(pos.x + (intent.dx / len) * step, -WORLD_WIDTH / 2, WORLD_WIDTH / 2);
      pos.y = clamp(pos.y + (intent.dy / len) * step, -WORLD_HEIGHT / 2, WORLD_HEIGHT / 2);

      // Moving while casting interrupts the spell.
      if (ctx.world.get(id, Combat)?.cast) {
        interruptCast(ctx, id, "interrupted by movement");
      }
    }
  }
}
