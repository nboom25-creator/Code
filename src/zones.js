// ===========================================================
// Zone definitions: two outdoor zones + one instanced dungeon.
// Each entry feeds the Zone builder in world.js.
//   entry : where the player appears when arriving
//   packs : enemy spawn groups [{key,count,rMin,rMax,lvl:[a,b]}]
//   portals: [{x,z,to,label,color}]
// ===========================================================

export const ZONES = {
  // ----------------- Starter zone -----------------
  vale: {
    id: "vale",
    name: "Northshire Vale",
    type: "outdoor",
    seed: 1337,
    amplitude: 26,
    flattenCenter: true,
    hamlet: true,
    sky: 0x8fb6e0, fog: 0x9fc0e4,
    entry: { x: 6, z: 6 },
    trees: 150, rocks: 60, flowers: 180,
    packs: [
      { key: "boar",   count: 10, rMin: 35,  rMax: 70,  lvl: [1, 3] },
      { key: "scout",  count: 10, rMin: 45,  rMax: 80,  lvl: [2, 4] },
      { key: "wolf",   count: 12, rMin: 60,  rMax: 110, lvl: [3, 6] },
      { key: "bandit", count: 12, rMin: 80,  rMax: 140, lvl: [5, 9] },
      { key: "ogre",   count: 4,  rMin: 120, rMax: 175, lvl: [9, 12] },
    ],
    portals: [
      { x: -60, z: -60, to: "wastes", label: "To the Emberfall Wastes", color: 0xff7a2a },
    ],
  },

  // ----------------- Second outdoor zone -----------------
  wastes: {
    id: "wastes",
    name: "Emberfall Wastes",
    type: "outdoor",
    seed: 7777,
    amplitude: 34,
    flattenCenter: false,
    hamlet: false,
    sky: 0xc97a44, fog: 0xb5673a,
    sunColor: 0xffd2a0, sunIntensity: 1.7, sunDisc: 0xffd070,
    hemiSky: 0xe0a060, hemiGround: 0x4a2a18,
    colLow: 0x8a5a32, colGrass: 0x9a6a30, colGrassDark: 0x7a4a22, colRock: 0x5a4030,
    trees: 40, deadTrees: true, trunkColor: 0x3a2a1c,
    rocks: 90, water: false, flowers: false,
    waterColor: 0x803020,
    entry: { x: 50, z: 50 },
    packs: [
      { key: "scout",  count: 12, rMin: 35,  rMax: 80,  lvl: [8, 11] },
      { key: "wolf",   count: 12, rMin: 50,  rMax: 110, lvl: [9, 13] },
      { key: "bandit", count: 14, rMin: 70,  rMax: 140, lvl: [11, 15] },
      { key: "ogre",   count: 8,  rMin: 90,  rMax: 180, lvl: [14, 18] },
    ],
    portals: [
      { x: 60, z: 60, to: "vale", label: "Back to Northshire Vale", color: 0x4aa0ff },
      { x: -50, z: -50, to: "crypt", label: "Enter Shadowfang Crypt", color: 0x9a40ff },
    ],
  },

  // ----------------- Instanced dungeon -----------------
  crypt: {
    id: "crypt",
    name: "Shadowfang Crypt",
    type: "dungeon",
    width: 26, length: 130, floorY: 0,
    sky: 0x080610, fog: 0x080610,
    entry: { x: 0, z: 2 },
    // mobs scattered down the hall (placed by x/z explicitly via packs w/ dungeon flag)
    packs: [
      { key: "skeleton", count: 8,  dungeon: true, zStart: -12, zEnd: -90, lvl: [12, 15] },
      { key: "wraith",   count: 5,  dungeon: true, zStart: -30, zEnd: -100, lvl: [13, 16] },
    ],
    boss: { key: "boss", lvl: 18 },
    portals: [
      { x: 0, z: 5, to: "wastes", label: "Leave the Crypt", color: 0x4aa0ff },
    ],
  },
};
