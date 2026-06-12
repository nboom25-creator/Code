/**
 * Resource (power) types shared by client and server.
 *
 * A unit has exactly one active power type, fixed by its class (see
 * `classes.ts`). This module only owns the power-type primitives and their
 * presentation; class definitions and stances live alongside in `classes.ts`.
 */

export type PowerType = "mana" | "energy" | "rage";

/** UI accent color per power type. */
export const POWER_COLORS: Record<PowerType, string> = {
  mana: "#3f7fff", // blue
  energy: "#f4d03f", // yellow
  rage: "#d24b4b", // red
};

export function powerLabel(type: PowerType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
