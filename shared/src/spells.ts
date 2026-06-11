/**
 * Spell / ability definitions shared between server and client.
 *
 * The server uses these to resolve effects through the combat matrix; the
 * client uses them to render action-bar tooltips, cast-time previews and
 * combat-log school colours.
 */

import { MELEE_CRIT_MULTIPLIER, MELEE_RANGE } from "./constants.js";
import type { PowerType } from "./resources.js";

export type ResourceType = PowerType | "health";
export type DamageSchool = "physical" | "shadow" | "fire" | "frost" | "holy";

export interface SpellCost {
  type: ResourceType;
  amount: number;
}

/**
 * A weapon-based attack: rolls the melee attack table (miss / dodge / crit /
 * hit), uses the caster's weapon damage and is mitigated by armor.
 */
export interface WeaponEffect {
  kind: "weapon";
  /** Multiplier applied to the rolled weapon damage (1.5 = 150%). */
  multiplier: number;
  /** Flat bonus damage added after the multiplier. */
  bonus: number;
  school: DamageSchool;
  critMultiplier: number;
}

/**
 * A direct spell hit: rolls damage in [min, max], can crit, and (for non
 * physical schools) ignores armor. Spells bypass the miss/dodge melee table.
 */
export interface SpellDamageEffect {
  kind: "spell";
  min: number;
  max: number;
  school: DamageSchool;
  critMultiplier: number;
}

export type SpellEffect = WeaponEffect | SpellDamageEffect;

export interface SpellDef {
  id: string;
  name: string;
  /** Cast time in ms. 0 means an instant cast. */
  castTime: number;
  cost: SpellCost;
  /** Whether casting this spell triggers the Global Cooldown. */
  triggersGcd: boolean;
  /** Maximum range in world units the target may be at. */
  range: number;
  effect: SpellEffect;
  /** Short text for tooltips / action bar. */
  description: string;
}

export const SPELLS: Record<string, SpellDef> = {
  mortalstrike: {
    id: "mortalstrike",
    name: "Mortal Strike",
    castTime: 0,
    cost: { type: "rage", amount: 30 },
    triggersGcd: true,
    range: MELEE_RANGE,
    effect: {
      kind: "weapon",
      multiplier: 1.5,
      bonus: 0,
      school: "physical",
      critMultiplier: MELEE_CRIT_MULTIPLIER,
    },
    description: "Instant. 30 Rage. A vicious strike for 150% weapon damage.",
  },
  sinisterstrike: {
    id: "sinisterstrike",
    name: "Sinister Strike",
    castTime: 0,
    cost: { type: "energy", amount: 40 },
    triggersGcd: true,
    range: MELEE_RANGE,
    effect: {
      kind: "weapon",
      multiplier: 1.0,
      bonus: 15,
      school: "physical",
      critMultiplier: MELEE_CRIT_MULTIPLIER,
    },
    description: "Instant. 40 Energy. Weapon damage plus 15.",
  },
  fireball: {
    id: "fireball",
    name: "Fireball",
    castTime: 2000,
    cost: { type: "mana", amount: 30 },
    triggersGcd: true,
    range: 300,
    effect: {
      kind: "spell",
      min: 30,
      max: 45,
      school: "fire",
      critMultiplier: 1.5,
    },
    description: "2.0s cast. 30 Mana. Hurls a fireball for 30-45 Fire damage.",
  },
};

export function getSpell(id: string): SpellDef | undefined {
  return SPELLS[id];
}
