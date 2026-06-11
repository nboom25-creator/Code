// ===========================================================
// The world map: a 4x4 grid of 16 unique biome regions forming
// one seamless continent. Provides global height/color samplers
// (blended across region borders) and per-region creature lists.
// ===========================================================
import * as THREE from "three";

export const GRID = 4;
export const CELL = 480;                 // size of one region in world units
export const WORLD_HALF = (GRID * CELL) / 2;   // 960
export const WORLD_SIZE = WORLD_HALF;     // back-compat alias

// ---- region definitions ----
// baseH: mean elevation, amp: terrain roughness, water regions go negative.
// colors blended bilinearly between region centers for smooth biomes.
export const REGION_DEFS = {
  frostspire: { name: "Frostspire Peaks", baseH: 22, amp: 30, lvl: [15, 20],
    colLow: 0xbcc8d8, colGrass: 0xdfe8f2, colRock: 0x8a98ac, snow: true,
    trees: 14, treeKind: "pine", leaf: [0x8aa6b0, 0xa0c0c8], trunk: 0x4a4438, rocks: 60,
    creatures: ["frostwolf", "yeti", "iceelem"] },
  stormpeak: { name: "Stormpeak Highlands", baseH: 16, amp: 26, lvl: [10, 15],
    colLow: 0x6a7250, colGrass: 0x6f8a4a, colRock: 0x6b6256,
    trees: 26, treeKind: "pine", leaf: [0x3a6a3a, 0x4a7a3a], trunk: 0x5a4326, rocks: 80,
    creatures: ["cragboar", "gryphon", "stormelem"] },
  direhollow: { name: "Direhollow", baseH: 6, amp: 14, lvl: [32, 40],
    colLow: 0x3a3540, colGrass: 0x444050, colRock: 0x2a2630, gloom: true,
    trees: 50, treeKind: "dead", leaf: [0x2a2a30], trunk: 0x201a24, rocks: 40,
    creatures: ["skeleton", "banshee", "direbat"] },
  themaw: { name: "The Maw", baseH: 4, amp: 20, lvl: [45, 55],
    colLow: 0x401018, colGrass: 0x5a1420, colRock: 0x2a0810, hell: true,
    trees: 20, treeKind: "dead", leaf: [0x3a0810], trunk: 0x1a0408, rocks: 70,
    creatures: ["felhound", "demon", "dreadlord"] },

  wildgrove: { name: "Wildgrove", baseH: 5, amp: 16, lvl: [5, 10],
    colLow: 0xa88a4a, colGrass: 0x8a7a32, colRock: 0x6a5236,
    trees: 70, treeKind: "autumn", leaf: [0xd07a20, 0xc04a20, 0xe0a030], trunk: 0x5a3a1c, rocks: 40,
    creatures: ["stag", "direwolf", "grizzly"] },
  whisperwood: { name: "Whisperwood", baseH: 3, amp: 14, lvl: [1, 6], start: true, hamlet: true,
    colLow: 0x6a8c4a, colGrass: 0x5a8c3a, colRock: 0x6b6256,
    trees: 80, treeKind: "pine", leaf: [0x2f7a32, 0x3d8c3a, 0x4a9c45], trunk: 0x5a3a1c, rocks: 50,
    creatures: ["boar", "stalker", "treant"] },
  shadowmoor: { name: "Shadowmoor", baseH: 5, amp: 16, lvl: [18, 24], dungeon: "crypt",
    colLow: 0x2a2838, colGrass: 0x322f44, colRock: 0x242230, gloom: true,
    trees: 60, treeKind: "dead", leaf: [0x2a2440], trunk: 0x1c1626, rocks: 50,
    creatures: ["shadowstalker", "ghoul", "wraith"] },
  crystalvale: { name: "Crystalvale", baseH: 7, amp: 18, lvl: [24, 30],
    colLow: 0x4a4a8a, colGrass: 0x5a5aa0, colRock: 0x6a6ac0, crystal: true,
    trees: 18, treeKind: "crystal", leaf: [0x9a80ff, 0xc0a0ff], trunk: 0x6a5aa0, rocks: 70,
    creatures: ["manawyrm", "crystalgolem", "arcanesprite"] },

  goldmeadow: { name: "Goldmeadow Plains", baseH: 2, amp: 10, lvl: [3, 8],
    colLow: 0x9aa84a, colGrass: 0x8fbf4a, colRock: 0x8a7a50,
    trees: 30, treeKind: "round", leaf: [0x6abf3a, 0x7acf4a], trunk: 0x6a4326, rocks: 30, flowers: true,
    creatures: ["plainslion", "raptor", "bandit"] },
  thornmarsh: { name: "Thornmarsh", baseH: 0.5, amp: 8, lvl: [8, 13], water: true,
    colLow: 0x3a4a2a, colGrass: 0x4a5a30, colRock: 0x3a3a28,
    trees: 45, treeKind: "willow", leaf: [0x4a6a2a, 0x5a7a3a], trunk: 0x3a3024, rocks: 20,
    creatures: ["boglurker", "croc", "wisp"] },
  ashbadlands: { name: "Ashen Badlands", baseH: 6, amp: 22, lvl: [14, 19],
    colLow: 0x8a5a32, colGrass: 0x9a6a30, colRock: 0x5a4030,
    trees: 18, treeKind: "dead", leaf: [0x3a2a1c], trunk: 0x3a2a1c, rocks: 110,
    creatures: ["rockgolem", "vulture", "marauder"] },
  emberfall: { name: "Emberfall Wastes", baseH: 8, amp: 26, lvl: [28, 34],
    colLow: 0x5a2418, colGrass: 0x7a3018, colRock: 0x3a1810, lava: true,
    trees: 14, treeKind: "dead", leaf: [0x3a1208], trunk: 0x2a1008, rocks: 90,
    creatures: ["lavahound", "magmaelem", "scorchling"] },

  mistral: { name: "Mistral Coast", baseH: 0.2, amp: 6, lvl: [6, 11], water: true,
    colLow: 0xd8c890, colGrass: 0xc8b878, colRock: 0x9a8a6a, beach: true,
    trees: 22, treeKind: "palm", leaf: [0x4a9a3a, 0x5aaa4a], trunk: 0x8a6a3a, rocks: 30,
    creatures: ["sandcrab", "reefcrawler", "siren"] },
  verdant: { name: "Verdant Jungle", baseH: 4, amp: 18, lvl: [12, 17],
    colLow: 0x2a5a2a, colGrass: 0x2f7a2f, colRock: 0x3a4a28,
    trees: 95, treeKind: "jungle", leaf: [0x1f6a1f, 0x2a8a2a, 0x3aaa3a], trunk: 0x4a3a1c, rocks: 30,
    creatures: ["panther", "venomserp", "headhunter"] },
  bloodfen: { name: "Bloodfen", baseH: 0.8, amp: 9, lvl: [20, 26], water: true, redwater: true,
    colLow: 0x5a2a2a, colGrass: 0x6a3030, colRock: 0x4a2424,
    trees: 50, treeKind: "willow", leaf: [0x6a3a2a, 0x7a4030], trunk: 0x3a2420, rocks: 24,
    creatures: ["bloodleech", "bogtroll", "plaguerat"] },
  sunscorch: { name: "Sunscorch Desert", baseH: 3, amp: 16, lvl: [22, 28],
    colLow: 0xd8b870, colGrass: 0xc9a060, colRock: 0xa88a50, sand: true,
    trees: 10, treeKind: "palm", leaf: [0x7a9a3a], trunk: 0x9a7a40, rocks: 50,
    creatures: ["sandwurm", "scarab", "dustraider"] },
};

// grid layout [row][col]; row 0 = north.
export const LAYOUT = [
  ["frostspire",  "stormpeak",   "direhollow",  "themaw"],
  ["wildgrove",   "whisperwood", "shadowmoor",  "crystalvale"],
  ["goldmeadow",  "thornmarsh",  "ashbadlands", "emberfall"],
  ["mistral",     "verdant",     "bloodfen",    "sunscorch"],
];

export function regionAt(cx, cz) {
  cx = THREE.MathUtils.clamp(cx, 0, GRID - 1);
  cz = THREE.MathUtils.clamp(cz, 0, GRID - 1);
  return REGION_DEFS[LAYOUT[cz][cx]];
}
export function cellOf(x, z) {
  return [
    THREE.MathUtils.clamp(Math.floor((x + WORLD_HALF) / CELL), 0, GRID - 1),
    THREE.MathUtils.clamp(Math.floor((z + WORLD_HALF) / CELL), 0, GRID - 1),
  ];
}
export function cellCenter(cx, cz) {
  return [(cx + 0.5) * CELL - WORLD_HALF, (cz + 0.5) * CELL - WORLD_HALF];
}
export function regionAtWorld(x, z) { const [cx, cz] = cellOf(x, z); return regionAt(cx, cz); }
export function startSpawn() {
  for (let cz = 0; cz < GRID; cz++) for (let cx = 0; cx < GRID; cx++)
    if (regionAt(cx, cz).start) { const [x, z] = cellCenter(cx, cz); return { x, z }; }
  return { x: 0, z: 0 };
}

// ---- noise ----
function makeNoise(seed) {
  const rand = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453; return n - Math.floor(n); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const tl = rand(xi, yi), tr = rand(xi + 1, yi), bl = rand(xi, yi + 1), br = rand(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
  };
}
const n1 = makeNoise(1337), n2 = makeNoise(5501), n3 = makeNoise(9911);

// bilinear blend of a numeric region field across the 4 nearest region centers
function blendField(x, z, field) {
  const fx = (x + WORLD_HALF) / CELL - 0.5;
  const fz = (z + WORLD_HALF) / CELL - 0.5;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const v = (cx, cz) => field(regionAt(cx, cz));
  const top = THREE.MathUtils.lerp(v(x0, z0), v(x0 + 1, z0), tx);
  const bot = THREE.MathUtils.lerp(v(x0, z0 + 1), v(x0 + 1, z0 + 1), tx);
  return THREE.MathUtils.lerp(top, bot, tz);
}

export function sampleHeight(x, z) {
  const baseH = blendField(x, z, r => r.baseH);
  const amp = blendField(x, z, r => r.amp);
  const f1 = n1(x * 0.0045, z * 0.0045) - 0.5;   // broad
  const f2 = n2(x * 0.02, z * 0.02) - 0.5;        // medium
  const f3 = n3(x * 0.08, z * 0.08) - 0.5;        // detail
  let h = baseH + f1 * amp + f2 * (amp * 0.35) + f3 * 2.0;
  // flatten the starter hamlet plaza
  const s = startSpawn();
  const d = Math.hypot(x - s.x, z - s.z);
  const flat = THREE.MathUtils.clamp(1 - d / 32, 0, 1);
  h = THREE.MathUtils.lerp(h, 2.0, flat * flat);
  return h;
}

const _cLow = new THREE.Color(), _cGrass = new THREE.Color(), _cRock = new THREE.Color(), _out = new THREE.Color();
function blendColor(x, z, key, target) {
  const fx = (x + WORLD_HALF) / CELL - 0.5, fz = (z + WORLD_HALF) / CELL - 0.5;
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const a = new THREE.Color(regionAt(x0, z0)[key]);
  const b = new THREE.Color(regionAt(x0 + 1, z0)[key]);
  const c = new THREE.Color(regionAt(x0, z0 + 1)[key]);
  const d = new THREE.Color(regionAt(x0 + 1, z0 + 1)[key]);
  a.lerp(b, tx); c.lerp(d, tx); a.lerp(c, tz);
  return target.copy(a);
}

export function sampleColor(x, z, y, target = _out) {
  if (y < 1.2) return blendColor(x, z, "colLow", target);
  if (y > 16) return blendColor(x, z, "colRock", target);
  blendColor(x, z, "colGrass", target);
  // slight per-vertex variation
  const v = n3(x * 0.15, z * 0.15) * 0.12 - 0.06;
  target.offsetHSL(0, 0, v);
  return target;
}

export const SEA_LEVEL = 0;
