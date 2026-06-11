// ===========================================================
// Items, rarities, procedural loot generation & drop tables.
// ===========================================================

export const SLOTS = ["weapon", "head", "shoulder", "chest", "hands", "legs", "feet", "ring", "trinket"];
export const SLOT_LABEL = {
  weapon: "Weapon", head: "Head", shoulder: "Shoulder", chest: "Chest",
  hands: "Hands", legs: "Legs", feet: "Feet", ring: "Ring", trinket: "Trinket",
};
export const SLOT_ICON = {
  weapon: "⚔️", head: "🪖", shoulder: "🎽", chest: "🛡️", hands: "🧤",
  legs: "👖", feet: "🥾", ring: "💍", trinket: "📿",
};

export const RARITY = {
  poor:     { name: "Poor",      color: "#9d9d9d", mult: 0.55, weight: 14 },
  common:   { name: "Common",    color: "#ffffff", mult: 0.8,  weight: 40 },
  uncommon: { name: "Uncommon",  color: "#1eff00", mult: 1.1,  weight: 28 },
  rare:     { name: "Rare",      color: "#0070dd", mult: 1.5,  weight: 13 },
  epic:     { name: "Epic",      color: "#a335ee", mult: 2.1,  weight: 4.5 },
  legendary:{ name: "Legendary", color: "#ff8000", mult: 3.0,  weight: 0.5 },
};

// Flavorful name parts.
const PREFIX = ["Rugged", "Gleaming", "Cursed", "Ancient", "Sturdy", "Savage", "Arcane", "Blessed", "Grim", "Runed", "Fel-touched", "Stormforged", "Gilded", "Wicked"];
const SUFFIX = {
  attackPower: ["of the Bear", "of Slaying", "of Power", "of the Tiger"],
  spellPower:  ["of the Sorcerer", "of Arcana", "of Flame", "of the Owl"],
  stamina:     ["of the Whale", "of Endurance", "of the Boar"],
  crit:        ["of the Falcon", "of Precision", "of the Hawk"],
  armor:       ["of the Wall", "of the Bulwark", "of Stone"],
  intellect:   ["of the Eagle", "of the Mind", "of Wisdom"],
};
const BASE_NAME = {
  weapon:   ["Longsword", "War Axe", "Maul", "Dagger", "Staff", "Mace", "Greatsword", "Spear"],
  head:     ["Helm", "Cowl", "Circlet", "Crown", "Hood"],
  shoulder: ["Spaulders", "Mantle", "Shoulderguards", "Epaulets"],
  chest:    ["Breastplate", "Tunic", "Robe", "Chestguard", "Hauberk"],
  hands:    ["Gauntlets", "Gloves", "Grips", "Handwraps"],
  legs:     ["Legplates", "Leggings", "Greaves", "Trousers"],
  feet:     ["Boots", "Sabatons", "Treads", "Sandals"],
  ring:     ["Band", "Signet", "Loop", "Ring"],
  trinket:  ["Idol", "Talisman", "Charm", "Figurine"],
};

// which stats a slot can roll
const SLOT_STATS = {
  weapon:   ["attackPower", "spellPower", "crit"],
  ring:     ["attackPower", "spellPower", "crit", "stamina", "intellect"],
  trinket:  ["attackPower", "spellPower", "crit", "stamina"],
  _armor:   ["stamina", "armor", "intellect", "crit"],
};

const STAT_LABEL = {
  stamina: "Stamina", intellect: "Intellect", attackPower: "Attack Power",
  spellPower: "Spell Power", crit: "Crit Rating", armor: "Armor",
};
export { STAT_LABEL };

let _uid = 0;

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function rollRarity(luck = 1) {
  // luck scales the weight of rare+ tiers
  const entries = Object.entries(RARITY).map(([k, v]) => {
    let w = v.weight;
    if (["rare", "epic", "legendary"].includes(k)) w *= luck;
    return [k, w];
  });
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return "common";
}

export function generateItem(slot, ilvl, opts = {}) {
  const rarityKey = opts.rarity || rollRarity(opts.luck || 1);
  const rarity = RARITY[rarityKey];
  const isArmor = !["weapon", "ring", "trinket"].includes(slot);
  const statPool = isArmor ? SLOT_STATS._armor : SLOT_STATS[slot];

  // budget grows with item level & rarity
  const budget = Math.round((4 + ilvl * 1.6) * rarity.mult);

  // pick a primary stat sensible for the slot
  let primary;
  if (slot === "weapon") primary = pick(["attackPower", "spellPower"]);
  else if (isArmor) primary = "stamina";
  else primary = pick(statPool);

  const stats = {};
  const numExtra = rarityKey === "poor" ? 0 : rarityKey === "common" ? 0 : rarityKey === "uncommon" ? 1 : rarityKey === "rare" ? 2 : 3;
  stats[primary] = Math.max(1, Math.round(budget * 0.6));
  if (isArmor) stats.armor = (stats.armor || 0) + Math.round(budget * 0.5);

  const extras = statPool.filter(s => s !== primary);
  for (let i = 0; i < numExtra && extras.length; i++) {
    const s = extras.splice((Math.random() * extras.length) | 0, 1)[0];
    stats[s] = (stats[s] || 0) + Math.max(1, Math.round(budget * (0.2 + Math.random() * 0.2)));
  }

  // name
  let name = `${pick(BASE_NAME[slot])}`;
  if (rarityKey === "uncommon" || rarityKey === "rare") name = `${pick(PREFIX)} ${name}`;
  if (rarityKey === "epic" || rarityKey === "legendary") {
    name = `${pick(PREFIX)} ${name} ${pick(SUFFIX[primary] || SUFFIX.stamina)}`;
  }

  return {
    uid: ++_uid,
    slot, name, rarity: rarityKey, ilvl,
    icon: SLOT_ICON[slot], stats,
  };
}

// Per-enemy drop tables: returns array of items (may be empty).
export function rollLoot(enemy, playerLevel) {
  const items = [];
  const t = enemy.type;
  const ilvl = Math.max(1, enemy.level);
  if (t.boss) {
    // boss: guaranteed epic + a couple extra rolls
    items.push(generateItem(pick(SLOTS), ilvl + 2, { rarity: Math.random() < 0.15 ? "legendary" : "epic" }));
    items.push(generateItem(pick(SLOTS), ilvl + 1, { luck: 6 }));
    items.push(generateItem(pick(SLOTS), ilvl, { luck: 4 }));
    return items;
  }
  const baseChance = t.elite ? 0.9 : 0.42;
  if (Math.random() < baseChance) {
    items.push(generateItem(pick(SLOTS), ilvl, { luck: t.elite ? 3 : 1 }));
  }
  // small chance of a bonus drop
  if (t.elite && Math.random() < 0.4) items.push(generateItem(pick(SLOTS), ilvl, { luck: 2 }));
  return items;
}

export function itemScore(item) {
  return Object.values(item.stats).reduce((a, b) => a + b, 0);
}
