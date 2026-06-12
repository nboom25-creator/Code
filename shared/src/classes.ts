/**
 * Class architecture: each class locks a character into a resource type, a set
 * of base stats and a list of stances/forms. Instantiating a class (server
 * side) seeds the entity's Stats, Power and stance state from this data — there
 * are no class-specific code paths in the engine, only data.
 */

import { MANA_REGEN_PER_SEC } from "./constants.js";
import type { PowerType } from "./resources.js";

export type ClassId = "warrior" | "rogue" | "mage";

/**
 * A stance / form. Multiplies damage dealt, damage taken and threat generated.
 * The engine reads these right before mitigation and threat application, so a
 * stance never needs bespoke combat code.
 */
export interface StanceDef {
  id: string;
  name: string;
  /** Short badge label shown near the unit frame. */
  badge: string;
  damageDealtMult: number;
  damageTakenMult: number;
  threatMult: number;
  color: string;
}

export interface ClassBaseStats {
  hp: number;
  armor: number;
  weaponMin: number;
  weaponMax: number;
  critChance: number;
  hpRegen: number;
  strength: number;
  agility: number;
  intellect: number;
  stamina: number;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  power: PowerType;
  powerMax: number;
  powerStart: number;
  manaRegen: number;
  /** First entry is the default stance the class spawns in. */
  stances: StanceDef[];
  base: ClassBaseStats;
}

const NEUTRAL_STANCE: StanceDef = {
  id: "neutral",
  name: "Normal",
  badge: "—",
  damageDealtMult: 1,
  damageTakenMult: 1,
  threatMult: 1,
  color: "#9aa0aa",
};

const BATTLE_STANCE: StanceDef = {
  id: "battle",
  name: "Battle Stance",
  badge: "Battle",
  damageDealtMult: 1,
  damageTakenMult: 1,
  threatMult: 1,
  color: "#d9a441",
};

const DEFENSIVE_STANCE: StanceDef = {
  id: "defensive",
  name: "Defensive Stance",
  badge: "Defensive",
  damageDealtMult: 0.9, // -10% damage dealt
  damageTakenMult: 0.9, // -10% damage taken
  threatMult: 1.3, // +130% (i.e. 1.3x) threat generated
  color: "#5a86c8",
};

const SHARED_BASE: ClassBaseStats = {
  hp: 100,
  armor: 30,
  weaponMin: 8,
  weaponMax: 12,
  critChance: 15,
  hpRegen: 6,
  strength: 20,
  agility: 20,
  intellect: 20,
  stamina: 20,
};

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: "warrior",
    name: "Warrior",
    power: "rage",
    powerMax: 100,
    powerStart: 0,
    manaRegen: 0,
    stances: [BATTLE_STANCE, DEFENSIVE_STANCE],
    base: { ...SHARED_BASE },
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    power: "energy",
    powerMax: 100,
    powerStart: 100,
    manaRegen: 0,
    stances: [NEUTRAL_STANCE],
    base: { ...SHARED_BASE },
  },
  mage: {
    id: "mage",
    name: "Mage",
    power: "mana",
    powerMax: 100,
    powerStart: 100,
    manaRegen: MANA_REGEN_PER_SEC,
    stances: [NEUTRAL_STANCE],
    base: { ...SHARED_BASE },
  },
};

export function getClass(id: ClassId): ClassDef {
  return CLASSES[id];
}

/** Resolve a stance within a class, falling back to the default stance. */
export function getStance(classId: ClassId, stanceId: string): StanceDef {
  const def = CLASSES[classId];
  return def.stances.find((s) => s.id === stanceId) ?? def.stances[0];
}
