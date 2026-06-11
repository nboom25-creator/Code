/**
 * Derived combat values. This is the single bridge between the data-driven
 * class / stance / talent definitions and the combat engine: the engine asks
 * for an *effective* number (crit, armor, cast time, stance multipliers) and
 * never inspects talents or stances directly. Append new talents or stances in
 * the shared data files and they flow through here automatically.
 */

import {
  computeTalentEffects,
  getStance,
  getSpell,
  type TalentEffects,
} from "@wow/shared";
import { ClassState, Stats, Talents } from "../ecs/components.js";
import type { EntityId, World } from "../ecs/World.js";

const NO_EFFECTS: TalentEffects = {
  physicalCritBonus: 0,
  armorMultiplier: 1,
  spellCastReductionMs: {},
};

export interface StanceMultipliers {
  damageDealt: number;
  damageTaken: number;
  threat: number;
}

const NEUTRAL_STANCE: StanceMultipliers = { damageDealt: 1, damageTaken: 1, threat: 1 };

export function talentEffects(world: World, id: EntityId): TalentEffects {
  const talents = world.get(id, Talents);
  return talents ? computeTalentEffects(talents.ranks) : NO_EFFECTS;
}

/** Base armor scaled by the Armored To The Teeth talent. */
export function effectiveArmor(world: World, id: EntityId): number {
  const stats = world.get(id, Stats);
  if (!stats) return 0;
  return stats.armor * talentEffects(world, id).armorMultiplier;
}

/** Crit chance (%) for a physical attack: base crit + Cruelty. */
export function physicalCritChance(world: World, id: EntityId): number {
  const base = world.get(id, Stats)?.critChance ?? 0;
  return base + talentEffects(world, id).physicalCritBonus;
}

/** Crit chance (%) for a spell of a given school (Cruelty only aids physical). */
export function spellCritChance(world: World, id: EntityId, physical: boolean): number {
  const base = world.get(id, Stats)?.critChance ?? 0;
  return physical ? base + talentEffects(world, id).physicalCritBonus : base;
}

/** Stance multipliers for an entity (neutral if it has no class/stance). */
export function stanceMultipliers(world: World, id: EntityId): StanceMultipliers {
  const cls = world.get(id, ClassState);
  if (!cls) return NEUTRAL_STANCE;
  const stance = getStance(cls.classId, cls.stanceId);
  return {
    damageDealt: stance.damageDealtMult,
    damageTaken: stance.damageTakenMult,
    threat: stance.threatMult,
  };
}

/** A spell's cast time after talent reductions (clamped at 0 = instant). */
export function effectiveCastTime(world: World, id: EntityId, spellId: string): number {
  const spell = getSpell(spellId);
  if (!spell) return 0;
  const reduction = talentEffects(world, id).spellCastReductionMs[spellId] ?? 0;
  return Math.max(0, spell.castTime - reduction);
}
