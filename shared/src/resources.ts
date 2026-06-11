/**
 * Resource (power) types and class profiles shared by client and server.
 *
 * A unit has exactly one active power type. Swapping the player's class profile
 * swaps the power type and reseeds its starting value, letting us exercise the
 * Rage / Energy / Mana mechanics from the same demo character.
 */

import { MANA_REGEN_PER_SEC } from "./constants.js";

export type PowerType = "mana" | "energy" | "rage";

export type ClassProfile = "warrior" | "rogue" | "mage";

export interface ProfileDef {
  profile: ClassProfile;
  label: string;
  power: PowerType;
  max: number;
  /** Value the resource is seeded with when this profile is selected. */
  start: number;
  /** Continuous mana regen per second (mana only). */
  manaRegen: number;
}

export const PROFILES: Record<ClassProfile, ProfileDef> = {
  warrior: {
    profile: "warrior",
    label: "Warrior",
    power: "rage",
    max: 100,
    start: 0,
    manaRegen: 0,
  },
  rogue: {
    profile: "rogue",
    label: "Rogue",
    power: "energy",
    max: 100,
    start: 100,
    manaRegen: 0,
  },
  mage: {
    profile: "mage",
    label: "Mage",
    power: "mana",
    max: 100,
    start: 100,
    manaRegen: MANA_REGEN_PER_SEC,
  },
};

/** UI accent color per power type. */
export const POWER_COLORS: Record<PowerType, string> = {
  mana: "#3f7fff", // blue
  energy: "#f4d03f", // yellow
  rage: "#d24b4b", // red
};

export function powerLabel(type: PowerType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
