// ===========================================================
// Game data: factions, races, classes, abilities
// (WoW-inspired but original names to keep it our own world)
// ===========================================================

export const FACTIONS = {
  alliance: { id: "alliance", name: "The Covenant", color: 0x2f5fb0, crest: "⚜" },
  horde:    { id: "horde",    name: "The Dominion", color: 0xa01818, crest: "⚔" },
};

// Each race: skin/hair palette + body proportions used by the model builder.
export const RACES = [
  // ---------------- COVENANT (good) ----------------
  {
    id: "human", faction: "alliance", name: "Human", emblem: "🛡️",
    blurb: "Stalwart and adaptable kingdom-folk.",
    lore: "From the green hills of Stormhaven, humans are diplomats and warriors alike — versatile masters of every craft.",
    traits: ["Diplomacy: +10% reputation", "The Human Spirit: +5% all stats"],
    color: 0xe0a878, hair: 0x5a3a1a, height: 1.0, build: 1.0, ears: "round",
    classes: ["warrior", "paladin", "mage", "priest", "rogue", "hunter"],
  },
  {
    id: "dwarf", faction: "alliance", name: "Stoneborn", emblem: "⛏️",
    blurb: "Hardy mountain-kin and master smiths.",
    lore: "Carved from the roots of the Ironpeak mountains, the Stoneborn are stout, fearless, and famed for rune-forged steel.",
    traits: ["Stoneform: removes poison & bleed", "+15% armor"],
    color: 0xd8a070, hair: 0x9a4a1a, height: 0.78, build: 1.35, ears: "round",
    classes: ["warrior", "paladin", "hunter", "priest", "rogue", "mage"],
  },
  {
    id: "elf", faction: "alliance", name: "Sylvani", emblem: "🌙",
    blurb: "Ancient guardians of the moonlit forest.",
    lore: "Immortal keepers of the Whisperwood, the Sylvani draw power from the moon and the wild things of the world.",
    traits: ["Shadowmeld: vanish when still", "+10% dodge"],
    color: 0xa9d6c0, hair: 0x2a5a6a, height: 1.12, build: 0.85, ears: "long",
    classes: ["hunter", "rogue", "priest", "mage", "warrior", "paladin"],
  },
  {
    id: "gnome", faction: "alliance", name: "Tinker", emblem: "⚙️",
    blurb: "Brilliant pint-sized inventors.",
    lore: "From the gear-halls of Cogspire, Tinkers solve every problem with enough springs, gears, and reckless optimism.",
    traits: ["Escape Artist: break roots", "+15% mana"],
    color: 0xf0c090, hair: 0xd03060, height: 0.6, build: 0.9, ears: "round",
    classes: ["mage", "rogue", "warrior", "priest", "hunter", "paladin"],
  },
  {
    id: "celestial", faction: "alliance", name: "Lightborn", emblem: "✨",
    blurb: "Exiled travelers blessed by the Light.",
    lore: "Crashed upon this world from beyond the stars, the Lightborn carry crystalline faith and ancient sorrow.",
    traits: ["Gift of the Naaru: heal over time", "+1% magic resist"],
    color: 0x9ec6e8, hair: 0x3a78a8, height: 1.18, build: 1.15, ears: "long",
    classes: ["paladin", "priest", "mage", "warrior", "hunter", "rogue"],
  },
  {
    id: "wildkin", faction: "alliance", name: "Wildkin", emblem: "🐺",
    blurb: "Cursed folk who bear the wolf within.",
    lore: "Once nobles of Gloomhaven, the Wildkin fight to master the feral curse that grants them savage strength.",
    traits: ["Feral Rush: +sprint speed", "+5% crit"],
    color: 0x8a7a6a, hair: 0x3a2a1a, height: 1.15, build: 1.25, ears: "long",
    classes: ["warrior", "rogue", "hunter", "mage", "priest", "paladin"],
  },

  // ---------------- DOMINION (bad) ----------------
  {
    id: "orc", faction: "horde", name: "Grok'mar", emblem: "🪓",
    blurb: "Proud warrior clans of the red wastes.",
    lore: "Forged in the blood-soaked deserts of Dur'gak, the Grok'mar live by strength, honor, and the roar of battle.",
    traits: ["Blood Fury: +attack power burst", "+15% stun resist"],
    color: 0x6aa050, hair: 0x101010, height: 1.05, build: 1.45, ears: "long",
    classes: ["warrior", "hunter", "rogue", "mage", "priest", "paladin"],
  },
  {
    id: "undead", faction: "horde", name: "Forsaken", emblem: "💀",
    blurb: "The risen dead, free of life and death.",
    lore: "Torn from their graves and freed from a dark master, the Forsaken plot vengeance from the catacombs of Deathknell.",
    traits: ["Will of the Forsaken: break fear", "Cannibalize: heal on corpses"],
    color: 0x9aa6a0, hair: 0x2a2a3a, height: 1.0, build: 0.9, ears: "round",
    classes: ["rogue", "mage", "priest", "warrior", "hunter", "paladin"],
  },
  {
    id: "tauren", faction: "horde", name: "Korhada", emblem: "🐂",
    blurb: "Towering spiritual plains-dwellers.",
    lore: "The horned Korhada roam the golden plains of Mulgar, honoring the Earthmother and the balance of all things.",
    traits: ["War Stomp: aoe stun", "+25% health"],
    color: 0x9a6a3a, hair: 0x4a2a10, height: 1.35, build: 1.6, ears: "long",
    classes: ["warrior", "hunter", "priest", "paladin", "mage", "rogue"],
  },
  {
    id: "trollkin", faction: "horde", name: "Zandari", emblem: "🗿",
    blurb: "Cunning jungle hunters and voodoo-mystics.",
    lore: "From the fever-jungles of Echo Isles, the Zandari blend savage agility with the dark arts of the loa.",
    traits: ["Berserking: +haste at low health", "+regeneration"],
    color: 0x5a8ab0, hair: 0xd02020, height: 1.2, build: 0.95, ears: "long",
    classes: ["hunter", "rogue", "mage", "priest", "warrior", "paladin"],
  },
  {
    id: "sunsworn", faction: "horde", name: "Sunsworn", emblem: "🔆",
    blurb: "Vain, magic-addicted high elves.",
    lore: "Seeking to reclaim lost glory, the Sunsworn drink deep of arcane power from the ruins of Silverhall.",
    traits: ["Arcane Torrent: silence + mana", "+1% spell crit"],
    color: 0xe8c0a0, hair: 0xf0d040, height: 1.1, build: 0.85, ears: "long",
    classes: ["mage", "priest", "paladin", "rogue", "hunter", "warrior"],
  },
  {
    id: "sapper", faction: "horde", name: "Sapper", emblem: "💣",
    blurb: "Greedy, explosive-loving schemers.",
    lore: "The Sappers of Brineport will sell you anything, blow up everything, and turn a profit either way.",
    traits: ["Rocket Jump: leap forward", "+1% attack speed"],
    color: 0x8ab030, hair: 0x202020, height: 0.62, build: 0.95, ears: "long",
    classes: ["rogue", "mage", "warrior", "hunter", "priest", "paladin"],
  },
];

// ---------------- Classes ----------------
export const CLASSES = {
  warrior: { id: "warrior", name: "Warrior", icon: "⚔️", resource: "rage",
    baseHp: 140, baseMp: 0, hpPerLvl: 22, mpPerLvl: 0, color: 0xc79c6e, ranged: false,
    desc: "A melee bruiser. High health, sustained damage." },
  paladin: { id: "paladin", name: "Paladin", icon: "🔨", resource: "mana",
    baseHp: 130, baseMp: 80, hpPerLvl: 20, mpPerLvl: 10, color: 0xf58cba, ranged: false,
    desc: "Holy warrior. Heals and smites in equal measure." },
  hunter:  { id: "hunter", name: "Hunter", icon: "🏹", resource: "mana",
    baseHp: 110, baseMp: 70, hpPerLvl: 16, mpPerLvl: 10, color: 0xabd473, ranged: true,
    desc: "Ranged marksman with a loyal pet." },
  rogue:   { id: "rogue", name: "Rogue", icon: "🗡️", resource: "energy",
    baseHp: 105, baseMp: 0, hpPerLvl: 15, mpPerLvl: 0, color: 0xfff569, ranged: false,
    desc: "Stealthy assassin. Burst damage from the shadows." },
  mage:    { id: "mage", name: "Mage", icon: "🔮", resource: "mana",
    baseHp: 85,  baseMp: 130, hpPerLvl: 11, mpPerLvl: 18, color: 0x69ccf0, ranged: true,
    desc: "Master of fire and frost. Devastating ranged spells." },
  priest:  { id: "priest", name: "Priest", icon: "✚", resource: "mana",
    baseHp: 90,  baseMp: 120, hpPerLvl: 12, mpPerLvl: 16, color: 0xffffff, ranged: true,
    desc: "Wielder of holy and shadow. Heals and damages." },
};

// ---------------- Abilities ----------------
// type: melee | ranged | heal | buff ; school for color of projectile
export const ABILITIES = {
  // generic
  attack:   { id:"attack", name:"Strike", icon:"⚔️", cost:0, cd:0,   range:3,  type:"melee",  min:6,  max:10, school:"phys", desc:"A basic melee strike." },
  shoot:    { id:"shoot", name:"Shoot", icon:"🏹", cost:0, cd:0,   range:24, type:"ranged", min:7,  max:11, school:"phys", desc:"A basic ranged shot." },

  // warrior
  heroic:   { id:"heroic", name:"Heroic Strike", icon:"💥", cost:0, cd:1.5, range:3, type:"melee", min:14, max:20, school:"phys", desc:"A mighty blow that deals heavy weapon damage." },
  whirl:    { id:"whirl", name:"Whirlwind", icon:"🌀", cost:0, cd:6, range:5, type:"aoe", min:10, max:16, school:"phys", desc:"Spin, striking all nearby enemies." },
  charge:   { id:"charge", name:"Charge", icon:"🐎", cost:0, cd:8, range:25, type:"dash", min:8, max:12, school:"phys", desc:"Rush a target, stunning briefly." },

  // paladin
  smite:    { id:"smite", name:"Crusader Strike", icon:"🔨", cost:6, cd:2, range:3, type:"melee", min:13, max:19, school:"holy", desc:"Strike imbued with the Light." },
  holylight:{ id:"holylight", name:"Holy Light", icon:"🌟", cost:18, cd:0, range:20, cast:1.6, type:"heal", min:30, max:42, school:"holy", desc:"A potent heal." },
  judge:    { id:"judge", name:"Judgement", icon:"⚖️", cost:10, cd:5, range:18, type:"ranged", min:16, max:24, school:"holy", desc:"Hurl righteous fury at a foe." },

  // hunter
  arcane:   { id:"arcane", name:"Arcane Shot", icon:"🎯", cost:8, cd:3, range:24, type:"ranged", min:14, max:20, school:"arcane", desc:"An instant shot of arcane energy." },
  multi:    { id:"multi", name:"Multi-Shot", icon:"🏹", cost:14, cd:6, range:24, type:"ranged_aoe", min:10, max:15, school:"phys", desc:"Fire at several enemies at once." },
  steady:   { id:"steady", name:"Aimed Shot", icon:"🎯", cost:6, cd:0, range:26, cast:1.4, type:"ranged", min:22, max:30, school:"phys", desc:"A slow, powerful aimed shot." },

  // rogue
  sinister: { id:"sinister", name:"Sinister Strike", icon:"🗡️", cost:8, cd:0, range:3, type:"melee", min:11, max:16, school:"phys", desc:"A quick, vicious stab." },
  eviscer:  { id:"eviscer", name:"Eviscerate", icon:"🔪", cost:14, cd:3, range:3, type:"melee", min:20, max:30, school:"phys", desc:"A finishing blow." },
  ambush:   { id:"ambush", name:"Ambush", icon:"💢", cost:12, cd:8, range:3, type:"melee", min:26, max:34, school:"phys", desc:"A devastating opener." },

  // mage
  firebolt: { id:"firebolt", name:"Fireball", icon:"🔥", cost:12, cd:0, range:26, cast:1.5, type:"ranged", min:18, max:26, school:"fire", desc:"Hurl a fiery ball that burns the target." },
  frost:    { id:"frost", name:"Frostbolt", icon:"❄️", cost:10, cd:0, range:26, cast:1.3, type:"ranged", min:14, max:20, school:"frost", slow:true, desc:"A bolt of ice that slows the target." },
  nova:     { id:"nova", name:"Arcane Blast", icon:"✦", cost:16, cd:4, range:22, type:"ranged", min:22, max:30, school:"arcane", desc:"A burst of pure arcane power." },

  // priest
  shadow:   { id:"shadow", name:"Mind Blast", icon:"🟣", cost:12, cd:3, range:24, type:"ranged", min:16, max:24, school:"shadow", desc:"Assault the target's mind." },
  smite2:   { id:"smite2", name:"Smite", icon:"🔆", cost:9, cd:0, range:24, cast:1.3, type:"ranged", min:13, max:19, school:"holy", desc:"Smite a foe with holy fire." },
  heal:     { id:"heal", name:"Flash Heal", icon:"💚", cost:16, cd:0, range:22, cast:1.2, type:"heal", min:28, max:38, school:"holy", desc:"A fast heal." },
};

// Ability layout per class (action bar slots 1..N)
export const CLASS_KIT = {
  warrior: ["heroic", "whirl", "charge", "attack"],
  paladin: ["smite", "judge", "holylight", "attack"],
  hunter:  ["steady", "arcane", "multi", "shoot"],
  rogue:   ["sinister", "eviscer", "ambush", "attack"],
  mage:    ["firebolt", "frost", "nova", "attack"],
  priest:  ["smite2", "shadow", "heal", "attack"],
};

// Projectile/school colors
export const SCHOOL_COLOR = {
  phys: 0xffffff, fire: 0xff5a1a, frost: 0x66ccff, arcane: 0xc060ff,
  holy: 0xffe27a, shadow: 0x9a40d0,
};

export function getRace(id) { return RACES.find(r => r.id === id); }
