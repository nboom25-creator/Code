/**
 * Server-authoritative stat recalculation.
 *
 * Effective Stats = Class Base + Equipped Gear + flat Talent modifiers, with
 * Max HP scaling off Stamina. This runs whenever gear, talents or class change.
 * School-specific talent effects (Cruelty's physical crit) and stance
 * multipliers remain dynamic in `derive.ts`/`combat.ts`; everything that maps
 * cleanly onto the attribute sheet is folded in here.
 */

import {
  HP_PER_STAMINA,
  computeTalentEffects,
  getClass,
  getItem,
  EQUIP_SLOTS,
} from "@wow/shared";
import { ClassState, Equipment, Stats, Talents } from "../ecs/components.js";
import type { EntityId, World } from "../ecs/World.js";

export function recalculateStats(world: World, id: EntityId): void {
  const stats = world.get(id, Stats);
  const cls = world.get(id, ClassState);
  if (!stats || !cls) return;
  const base = getClass(cls.classId).base;

  let strength = base.strength;
  let agility = base.agility;
  let intellect = base.intellect;
  let stamina = base.stamina;
  let armor = base.armor;
  let weaponMin = base.weaponMin;
  let weaponMax = base.weaponMax;

  // --- Equipped gear ---
  const equip = world.get(id, Equipment);
  if (equip) {
    for (const slot of EQUIP_SLOTS) {
      const itemId = equip.slots[slot];
      if (!itemId) continue;
      const item = getItem(itemId);
      if (!item) continue;
      const s = item.stats;
      strength += s.strength ?? 0;
      agility += s.agility ?? 0;
      intellect += s.intellect ?? 0;
      stamina += s.stamina ?? 0;
      armor += s.armor ?? 0;
      // A main-hand weapon replaces the wielder's weapon damage range.
      if (s.weaponMin != null && s.weaponMax != null) {
        weaponMin = s.weaponMin;
        weaponMax = s.weaponMax;
      }
    }
  }

  // --- Talents (Armored To The Teeth scales total armor) ---
  const talents = world.get(id, Talents);
  const effects = computeTalentEffects(talents ? talents.ranks : {});
  armor = Math.round(armor * effects.armorMultiplier);

  stats.attributes.strength = strength;
  stats.attributes.agility = agility;
  stats.attributes.intellect = intellect;
  stats.attributes.stamina = stamina;
  stats.armor = armor;
  stats.critChance = base.critChance;
  stats.weaponMinDamage = weaponMin;
  stats.weaponMaxDamage = weaponMax;

  // --- Max HP scales with Stamina above the class base ---
  const newMaxHp = base.hp + (stamina - base.stamina) * HP_PER_STAMINA;
  const delta = newMaxHp - stats.maxHp;
  stats.maxHp = newMaxHp;
  // Gaining stamina heals by the bonus; losing it reduces current HP (min 1).
  stats.hp = Math.max(1, Math.min(newMaxHp, stats.hp + delta));
}
