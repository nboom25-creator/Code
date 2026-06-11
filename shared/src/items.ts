/**
 * Item definitions, equipment slots and the global item database.
 *
 * Items are pure data. Equipping one feeds its `stats` into the server-side
 * `recalculateStats()` pass, which folds Base + Talents + Gear into the entity's
 * effective Stats — so an item never needs bespoke engine code.
 */

export type ItemQuality = "poor" | "common" | "uncommon" | "rare" | "epic";

/** Valid equipment slots (paper-doll). */
export type EquipSlot = "head" | "chest" | "hands" | "legs" | "mainhand";

export const EQUIP_SLOTS: EquipSlot[] = ["head", "chest", "hands", "legs", "mainhand"];

export const SLOT_LABELS: Record<EquipSlot, string> = {
  head: "Head",
  chest: "Chest",
  hands: "Hands",
  legs: "Legs",
  mainhand: "Main Hand",
};

/** Classic quality colors. */
export const QUALITY_COLORS: Record<ItemQuality, string> = {
  poor: "#9d9d9d", // grey
  common: "#ffffff", // white
  uncommon: "#1eff00", // green
  rare: "#0070dd", // blue
  epic: "#a335ee", // purple
};

export const QUALITY_LABELS: Record<ItemQuality, string> = {
  poor: "Poor",
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
};

/** Additive stat modifiers. Weapon damage on a Main Hand *replaces* the range. */
export interface ItemStats {
  strength?: number;
  agility?: number;
  intellect?: number;
  stamina?: number;
  armor?: number;
  /** Main-hand weapons set the wielder's weapon damage range. */
  weaponMin?: number;
  weaponMax?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  quality: ItemQuality;
  slot: EquipSlot;
  icon: string;
  stats: ItemStats;
}

export const ITEMS: Record<string, ItemDef> = {
  whirlwind_axe: {
    id: "whirlwind_axe",
    name: "Whirlwind Axe",
    quality: "epic",
    slot: "mainhand",
    icon: "🪓",
    stats: { strength: 15, stamina: 5, weaponMin: 40, weaponMax: 65 },
  },
  robes_archmage: {
    id: "robes_archmage",
    name: "Robes of the Archmage",
    quality: "epic",
    slot: "chest",
    icon: "🧥",
    stats: { intellect: 12, stamina: 8, armor: 15 },
  },
  tattered_gloves: {
    id: "tattered_gloves",
    name: "Tattered Leather Gloves",
    quality: "poor",
    slot: "hands",
    icon: "🧤",
    stats: { armor: 2 },
  },
};

export function getItem(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** Player backpack size (classic 16-slot backpack). */
export const INVENTORY_SIZE = 16;

/** Human-readable, ordered stat lines for tooltips. */
export function describeItemStats(stats: ItemStats): string[] {
  const lines: string[] = [];
  if (stats.weaponMin != null && stats.weaponMax != null) {
    lines.push(`${stats.weaponMin} - ${stats.weaponMax} Damage`);
  }
  if (stats.strength) lines.push(`+${stats.strength} Strength`);
  if (stats.agility) lines.push(`+${stats.agility} Agility`);
  if (stats.intellect) lines.push(`+${stats.intellect} Intellect`);
  if (stats.stamina) lines.push(`+${stats.stamina} Stamina`);
  if (stats.armor) lines.push(`+${stats.armor} Armor`);
  return lines;
}
