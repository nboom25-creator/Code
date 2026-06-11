import { Position } from "../ecs/components.js";
import type { EntityId, World } from "../ecs/World.js";

/** Euclidean distance between two entities that both own a Position. */
export function distance(world: World, a: EntityId, b: EntityId): number {
  const pa = world.get(a, Position);
  const pb = world.get(b, Position);
  if (!pa || !pb) return Infinity;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
