/* ============================================================
   data.js — Pokémon, moves, type chart, and the world map.
   A faithful-in-spirit (Gen 1) subset of Pokémon Red.
   ============================================================ */

const TYPES = ["normal","fire","water","grass","electric","poison","flying","bug","ground","rock","psychic"];

/* Attacker -> { defenderType: multiplier }. Anything unlisted is 1x. */
const TYPE_CHART = {
  fire:     { grass:2, bug:2, water:0.5, fire:0.5, rock:0.5 },
  water:    { fire:2, ground:2, rock:2, water:0.5, grass:0.5 },
  grass:    { water:2, ground:2, rock:2, fire:0.5, grass:0.5, poison:0.5, flying:0.5, bug:0.5 },
  electric: { water:2, flying:2, grass:0.5, electric:0.5, ground:0 },
  poison:   { grass:2, bug:2, poison:0.5, ground:0.5, rock:0.5 },
  flying:   { grass:2, bug:2, electric:0.5, rock:0.5 },
  bug:      { grass:2, psychic:2, poison:2, fire:0.5, flying:0.5 },
  ground:   { fire:2, electric:2, poison:2, rock:2, grass:0.5, bug:0.5, flying:0 },
  rock:     { fire:2, flying:2, bug:2, fighting:2 },
  psychic:  { poison:2, fire:0.5 },
  normal:   { rock:0.5 },
};

function typeEffectiveness(moveType, defenderTypes) {
  let mult = 1;
  for (const t of defenderTypes) {
    const row = TYPE_CHART[moveType];
    if (row && row[t] !== undefined) mult *= row[t];
  }
  return mult;
}

/* Moves. cat: "phys" | "spec" | "status" */
const MOVES = {
  tackle:      { name: "TACKLE",      type: "normal",   power: 40,  pp: 35, cat: "phys", acc: 100 },
  scratch:     { name: "SCRATCH",     type: "normal",   power: 40,  pp: 35, cat: "phys", acc: 100 },
  pound:       { name: "POUND",       type: "normal",   power: 40,  pp: 35, cat: "phys", acc: 100 },
  growl:       { name: "GROWL",       type: "normal",   power: 0,   pp: 40, cat: "status", acc: 100, effect: "lowerAtk" },
  tailwhip:    { name: "TAIL WHIP",   type: "normal",   power: 0,   pp: 30, cat: "status", acc: 100, effect: "lowerDef" },
  ember:       { name: "EMBER",       type: "fire",     power: 40,  pp: 25, cat: "spec", acc: 100 },
  flamethrower:{ name: "FLAMETHROWER",type: "fire",     power: 90,  pp: 15, cat: "spec", acc: 100 },
  watergun:    { name: "WATER GUN",   type: "water",    power: 40,  pp: 25, cat: "spec", acc: 100 },
  bubble:      { name: "BUBBLE",      type: "water",    power: 40,  pp: 30, cat: "spec", acc: 100 },
  vinewhip:    { name: "VINE WHIP",   type: "grass",    power: 45,  pp: 25, cat: "phys", acc: 100 },
  razorleaf:   { name: "RAZOR LEAF",  type: "grass",    power: 55,  pp: 25, cat: "phys", acc: 95 },
  thundershock:{ name: "THUNDERSHOK", type: "electric", power: 40,  pp: 30, cat: "spec", acc: 100 },
  thunderbolt: { name: "THUNDERBOLT", type: "electric", power: 90,  pp: 15, cat: "spec", acc: 100 },
  quickattack: { name: "QUICK ATTACK",type: "normal",   power: 40,  pp: 30, cat: "phys", acc: 100 },
  gust:        { name: "GUST",        type: "flying",   power: 40,  pp: 35, cat: "spec", acc: 100 },
  peck:        { name: "PECK",        type: "flying",   power: 35,  pp: 35, cat: "phys", acc: 100 },
  stringshot:  { name: "STRING SHOT", type: "bug",      power: 0,   pp: 40, cat: "status", acc: 95, effect: "lowerSpd" },
  poisonsting: { name: "POISON STING",type: "poison",   power: 15,  pp: 35, cat: "phys", acc: 100 },
  tackle2:     { name: "BUG BITE",    type: "bug",      power: 60,  pp: 20, cat: "phys", acc: 100 },
  bite:        { name: "BITE",        type: "normal",   power: 60,  pp: 25, cat: "phys", acc: 100 },
  rockthrow:   { name: "ROCK THROW",  type: "rock",     power: 50,  pp: 15, cat: "phys", acc: 90 },
  tackleground:{ name: "MAGNITUDE",   type: "ground",   power: 50,  pp: 30, cat: "phys", acc: 100 },
  leechseed:   { name: "LEECH LIFE",  type: "bug",      power: 20,  pp: 15, cat: "phys", acc: 100 },
  confusion:   { name: "CONFUSION",   type: "psychic",  power: 50,  pp: 25, cat: "spec", acc: 100 },
  absorb:      { name: "ABSORB",      type: "grass",    power: 20,  pp: 25, cat: "spec", acc: 100 },
  supersonic:  { name: "SUPERSONIC",  type: "normal",   power: 0,   pp: 20, cat: "status", acc: 55, effect: "lowerSpd" },
};

/* Pokédex. stats: hp, atk, def, spd, spc(special). */
const DEX = {
  bulbasaur: {
    id: 1, name: "BULBASAUR", types: ["grass","poison"],
    stats: { hp: 45, atk: 49, def: 49, spd: 45, spc: 65 },
    learn: { 1: ["tackle","growl"], 7: ["leechseed"], 13: ["vinewhip"], 20: ["razorleaf"] },
    evolve: { level: 16, into: "ivysaur" }, catchRate: 45, base: 64,
  },
  ivysaur: {
    id: 2, name: "IVYSAUR", types: ["grass","poison"],
    stats: { hp: 60, atk: 62, def: 63, spd: 60, spc: 80 },
    learn: { 1: ["tackle","growl","vinewhip"], 22: ["razorleaf"] },
    evolve: { level: 32, into: "venusaur" }, catchRate: 45, base: 141,
  },
  venusaur: {
    id: 3, name: "VENUSAUR", types: ["grass","poison"],
    stats: { hp: 80, atk: 82, def: 83, spd: 80, spc: 100 },
    learn: { 1: ["tackle","growl","vinewhip","razorleaf"] }, catchRate: 45, base: 208,
  },
  charmander: {
    id: 4, name: "CHARMANDER", types: ["fire"],
    stats: { hp: 39, atk: 52, def: 43, spd: 65, spc: 50 },
    learn: { 1: ["scratch","growl"], 9: ["ember"], 17: ["bite"], 24: ["flamethrower"] },
    evolve: { level: 16, into: "charmeleon" }, catchRate: 45, base: 65,
  },
  charmeleon: {
    id: 5, name: "CHARMELEON", types: ["fire"],
    stats: { hp: 58, atk: 64, def: 58, spd: 80, spc: 65 },
    learn: { 1: ["scratch","growl","ember"], 24: ["flamethrower"] },
    evolve: { level: 36, into: "charizard" }, catchRate: 45, base: 142,
  },
  charizard: {
    id: 6, name: "CHARIZARD", types: ["fire","flying"],
    stats: { hp: 78, atk: 84, def: 78, spd: 100, spc: 85 },
    learn: { 1: ["scratch","growl","ember","flamethrower"], 36: ["gust"] }, catchRate: 45, base: 209,
  },
  squirtle: {
    id: 7, name: "SQUIRTLE", types: ["water"],
    stats: { hp: 44, atk: 48, def: 65, spd: 43, spc: 50 },
    learn: { 1: ["tackle","tailwhip"], 8: ["bubble"], 15: ["watergun"], 22: ["bite"] },
    evolve: { level: 16, into: "wartortle" }, catchRate: 45, base: 66,
  },
  wartortle: {
    id: 8, name: "WARTORTLE", types: ["water"],
    stats: { hp: 59, atk: 63, def: 80, spd: 58, spc: 65 },
    learn: { 1: ["tackle","tailwhip","bubble","watergun"], 24: ["bite"] },
    evolve: { level: 36, into: "blastoise" }, catchRate: 45, base: 143,
  },
  blastoise: {
    id: 9, name: "BLASTOISE", types: ["water"],
    stats: { hp: 79, atk: 83, def: 100, spd: 78, spc: 85 },
    learn: { 1: ["tackle","tailwhip","watergun","bite"] }, catchRate: 45, base: 210,
  },
  pidgey: {
    id: 16, name: "PIDGEY", types: ["normal","flying"],
    stats: { hp: 40, atk: 45, def: 40, spd: 56, spc: 35 },
    learn: { 1: ["tackle"], 5: ["gust"], 12: ["quickattack"], 19: ["peck"] },
    evolve: { level: 18, into: "pidgeotto" }, catchRate: 255, base: 55,
  },
  pidgeotto: {
    id: 17, name: "PIDGEOTTO", types: ["normal","flying"],
    stats: { hp: 63, atk: 60, def: 55, spd: 71, spc: 50 },
    learn: { 1: ["tackle","gust","quickattack","peck"] }, catchRate: 120, base: 113,
  },
  rattata: {
    id: 19, name: "RATTATA", types: ["normal"],
    stats: { hp: 30, atk: 56, def: 35, spd: 72, spc: 25 },
    learn: { 1: ["tackle","tailwhip"], 7: ["quickattack"], 14: ["bite"] },
    evolve: { level: 20, into: "raticate" }, catchRate: 255, base: 57,
  },
  raticate: {
    id: 20, name: "RATICATE", types: ["normal"],
    stats: { hp: 55, atk: 81, def: 60, spd: 97, spc: 50 },
    learn: { 1: ["tackle","tailwhip","quickattack","bite"] }, catchRate: 127, base: 116,
  },
  spearow: {
    id: 21, name: "SPEAROW", types: ["normal","flying"],
    stats: { hp: 40, atk: 60, def: 30, spd: 70, spc: 31 },
    learn: { 1: ["peck","growl"], 9: ["quickattack"], 15: ["gust"] },
    evolve: { level: 20, into: "fearow" }, catchRate: 255, base: 58,
  },
  fearow: {
    id: 22, name: "FEAROW", types: ["normal","flying"],
    stats: { hp: 65, atk: 90, def: 65, spd: 100, spc: 61 },
    learn: { 1: ["peck","growl","quickattack","gust"] }, catchRate: 90, base: 162,
  },
  caterpie: {
    id: 10, name: "CATERPIE", types: ["bug"],
    stats: { hp: 45, atk: 30, def: 35, spd: 45, spc: 20 },
    learn: { 1: ["tackle","stringshot"] },
    evolve: { level: 7, into: "metapod" }, catchRate: 255, base: 53,
  },
  metapod: {
    id: 11, name: "METAPOD", types: ["bug"],
    stats: { hp: 50, atk: 20, def: 55, spd: 30, spc: 25 },
    learn: { 1: ["tackle"] },
    evolve: { level: 10, into: "butterfree" }, catchRate: 120, base: 72,
  },
  butterfree: {
    id: 12, name: "BUTTERFREE", types: ["bug","flying"],
    stats: { hp: 60, atk: 45, def: 50, spd: 70, spc: 80 },
    learn: { 1: ["confusion","gust"], 12: ["supersonic"] }, catchRate: 45, base: 160,
  },
  weedle: {
    id: 13, name: "WEEDLE", types: ["bug","poison"],
    stats: { hp: 40, atk: 35, def: 30, spd: 50, spc: 20 },
    learn: { 1: ["poisonsting","stringshot"] },
    evolve: { level: 7, into: "kakuna" }, catchRate: 255, base: 52,
  },
  kakuna: {
    id: 14, name: "KAKUNA", types: ["bug","poison"],
    stats: { hp: 45, atk: 25, def: 50, spd: 35, spc: 25 },
    learn: { 1: ["poisonsting"] },
    evolve: { level: 10, into: "beedrill" }, catchRate: 120, base: 71,
  },
  beedrill: {
    id: 15, name: "BEEDRILL", types: ["bug","poison"],
    stats: { hp: 65, atk: 80, def: 40, spd: 75, spc: 45 },
    learn: { 1: ["poisonsting","stringshot","tackle2"] }, catchRate: 45, base: 159,
  },
  pikachu: {
    id: 25, name: "PIKACHU", types: ["electric"],
    stats: { hp: 35, atk: 55, def: 30, spd: 90, spc: 50 },
    learn: { 1: ["thundershock","growl"], 9: ["quickattack"], 26: ["thunderbolt"] },
    evolve: { level: 22, into: "raichu" }, catchRate: 190, base: 82,
  },
  raichu: {
    id: 26, name: "RAICHU", types: ["electric"],
    stats: { hp: 60, atk: 90, def: 55, spd: 100, spc: 90 },
    learn: { 1: ["thundershock","quickattack","thunderbolt"] }, catchRate: 75, base: 122,
  },
  oddish: {
    id: 43, name: "ODDISH", types: ["grass","poison"],
    stats: { hp: 45, atk: 50, def: 55, spd: 30, spc: 75 },
    learn: { 1: ["absorb"], 15: ["poisonsting"] },
    evolve: { level: 21, into: "gloom" }, catchRate: 255, base: 78,
  },
  gloom: {
    id: 44, name: "GLOOM", types: ["grass","poison"],
    stats: { hp: 60, atk: 65, def: 70, spd: 40, spc: 85 },
    learn: { 1: ["absorb","poisonsting"] }, catchRate: 120, base: 132,
  },
  zubat: {
    id: 41, name: "ZUBAT", types: ["poison","flying"],
    stats: { hp: 40, atk: 45, def: 35, spd: 55, spc: 30 },
    learn: { 1: ["leechseed"], 10: ["supersonic"], 15: ["bite"] },
    evolve: { level: 22, into: "golbat" }, catchRate: 255, base: 54,
  },
  golbat: {
    id: 42, name: "GOLBAT", types: ["poison","flying"],
    stats: { hp: 75, atk: 80, def: 70, spd: 90, spc: 75 },
    learn: { 1: ["leechseed","supersonic","bite"] }, catchRate: 90, base: 171,
  },
  geodude: {
    id: 74, name: "GEODUDE", types: ["rock","ground"],
    stats: { hp: 40, atk: 80, def: 100, spd: 20, spc: 30 },
    learn: { 1: ["tackle"], 11: ["rockthrow"], 16: ["tackleground"] },
    evolve: { level: 25, into: "graveler" }, catchRate: 255, base: 86,
  },
  graveler: {
    id: 75, name: "GRAVELER", types: ["rock","ground"],
    stats: { hp: 55, atk: 95, def: 115, spd: 35, spc: 45 },
    learn: { 1: ["tackle","rockthrow","tackleground"] }, catchRate: 120, base: 134,
  },
};

const STARTERS = ["bulbasaur", "charmander", "squirtle"];

/* Items the player can carry. */
const ITEMS = {
  pokeball:  { name: "POKé BALL",  kind: "ball",  rate: 1,    desc: "Catches wild POKéMON." },
  greatball: { name: "GREAT BALL", kind: "ball",  rate: 1.5,  desc: "Better catch rate." },
  ultraball: { name: "ULTRA BALL", kind: "ball",  rate: 2,    desc: "Best catch rate." },
  potion:    { name: "POTION",     kind: "heal",  amount: 20, desc: "Restores 20 HP." },
  superpotion:{name: "SUPER POTION",kind:"heal",  amount: 50, desc: "Restores 50 HP." },
};

/* ============================================================
   World map. Each char is a tile (see TILES in engine.js).
   Encounter tables pick which Pokémon appear in tall grass.
   ============================================================ */

/* Tile legend:
   . grass (walkable)   t tall grass (encounters)   T tree (solid)
   p path (walkable)    w water (solid)             f flower (walkable)
   h house wall (solid) d door (warp / sign)        s sign (interact)
   r rock (solid)       F fence (solid)             c floor (walkable, town center)
   H heal tile (Pokémon Center marker)              M mart marker
   = ledge (jump down)  L lab door                  P player start (walkable)
*/

const WORLD = {
  // One large scrollable world: Pallet Town -> Route 1 -> Viridian City
  // -> Route 2 -> Viridian Forest -> a cabin. Every row is `width` (20) chars.
  width: 20,
  rows: [
    "TTTTTTTTTTTTTTTTTTTT", // 0   --- PALLET TOWN ---
    "T..................T", // 1
    "T..hhhh....hhhh....T", // 2   building roofs
    "T..hHHh....hMMh....T", // 3   H=Center  M=Mart
    "T..hddh....hddh....T", // 4   doors
    "T.........s........T", // 5   town sign
    "T........pp........T", // 6   path down the middle
    "T..tttt..pp........T", // 7   grass patch (town)
    "T..tttt..pp..tttt..T", // 8
    "T..tttt..pp..tttt..T", // 9
    "T........pp........T", // 10
    "T..hhhhh.pp........T", // 11  Oak's Lab roof
    "T..hLLLh.pp........T", // 12
    "T..hdddh.pp........T", // 13  lab doors
    "T....s...pp........T", // 14  lab sign
    "T........pp........T", // 15  --- ROUTE 1 ---
    "T........pp........T", // 16
    "T..ttt...pp...sss..T", // 17  route signs
    "T..ttt...pp........T", // 18
    "T..ttt...pp........T", // 19
    "T.....========.....T", // 20  ledge (hop down)
    "T..ttttt.pp.ttttt..T", // 21  route grass (path continues)
    "T..ttttt.pp.ttttt..T", // 22
    "T........pp........T", // 23
    "T........pp........T", // 24
    "TTTTTTTTTppTTTTTTTTT", // 25  city gate
    "T........pp........T", // 26  --- VIRIDIAN CITY ---
    "T........pp........T", // 27
    "T..hhhh..pp..hhhh..T", // 28  Center (left) & Mart (right)
    "T..hHHh..pp..hMMh..T", // 29
    "T..hddh..pp..hddh..T", // 30  doors
    "T........pp........T", // 31
    "T...wwww.pp........T", // 32  pond
    "T...wwww.pp..GGGG..T", // 33  Viridian Gym
    "T...wwww.pp..GGGG..T", // 34
    "T........pp..GddG..T", // 35  gym door
    "T..s.....pp....s...T", // 36  city signs
    "T........pp........T", // 37
    "T..hhhh..pp........T", // 38  a house
    "T..hddh..pp........T", // 39  house door
    "T........pp........T", // 40
    "TTTTTTTT.pp.TTTTTTTT", // 41  south gate
    "T........pp........T", // 42  --- ROUTE 2 ---
    "T..tt....pp....tt..T", // 43
    "T..tt....pp....tt..T", // 44
    "T........pp........T", // 45
    "T.tttttt.pp.tttttt.T", // 46  --- VIRIDIAN FOREST ---
    "T.tttttt.pp.tttttt.T", // 47
    "T.tttttt.pp.tttttt.T", // 48
    "T........pp........T", // 49
    "T..s.....pp........T", // 50  forest sign
    "T.TT.TT..pp..TT.TT.T", // 51  forest trees
    "T.TtttT..pp..TtttT.T", // 52
    "T..ttt...pp...ttt..T", // 53
    "T........pp........T", // 54
    "T..hhhh..pp........T", // 55  forest cabin
    "T..hddh..pp........T", // 56
    "T........pp........T", // 57
    "TTTTTTTTTTTTTTTTTTTT", // 58  world's edge
  ],
  playerStart: { x: 9, y: 5 },
  // Door tiles ("x,y") and what they do — handled in main.js.
  doors: {
    "4,4":  "center", "5,4":  "center",            // Pallet Pokémon Center
    "12,4": "mart",   "13,4": "mart",              // Pallet Poké Mart
    "4,13": "lab",    "5,13": "lab",  "6,13": "lab",// Oak's Lab: pick starter
    "4,30": "center", "5,30": "center",            // Viridian Pokémon Center
    "14,30": "mart",  "15,30": "mart",             // Viridian Poké Mart
    "14,35": "gym",   "15,35": "gym",              // Viridian Gym
    "4,39": "house",                               // Viridian house
    "4,56": "cabin",                               // Forest cabin
  },
  // Readable signs.
  signs: {
    "10,5":  "PALLET TOWN\nShades of your\njourney await!",
    "5,14":  "OAK POKéMON LAB\nThe door is open.",
    "14,17": "ROUTE 1\nPALLET - VIRIDIAN",
    "15,17": "Wild POKéMON live\nin the tall grass.\nWalk in to find them!",
    "16,17": "TRAINER TIPS:\nWeaken a POKéMON,\nthen throw a BALL!",
    "3,36":  "VIRIDIAN CITY\nThe Eternally Green\nParadise.",
    "15,36": "VIRIDIAN GYM\nLEADER: GIOVANNI\nThe door won't budge.",
    "3,50":  "ROUTE 2\nVIRIDIAN FOREST ahead.\nWild POKéMON here\nare stronger!",
  },
  // Encounter tables — Route 1 grass is mild; the forest is tougher.
  encounters: {
    early:  ["pidgey","rattata","caterpie","weedle","oddish","pidgey","rattata","spearow"],
    forest: ["caterpie","weedle","pidgey","pikachu","oddish","zubat","spearow","rattata","geodude"],
  },
};
