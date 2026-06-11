// ===========================================================
// Instanced zones (non-streamed). Currently just the dungeon;
// the open world is handled by the Overworld streamer.
// ===========================================================

export const ZONES = {
  crypt: {
    id: "crypt",
    name: "Shadowfang Crypt",
    type: "dungeon",
    width: 26, length: 130, floorY: 0,
    sky: 0x080610, fog: 0x080610,
    entry: { x: 0, z: 2 },
    packs: [
      { key: "cryptskeleton", count: 8, dungeon: true, zStart: -12, zEnd: -90, lvl: [18, 22] },
      { key: "cryptwraith",   count: 5, dungeon: true, zStart: -30, zEnd: -100, lvl: [19, 23] },
    ],
    boss: { key: "mortis", lvl: 26 },
    portals: [
      { x: 0, z: 6, to: "overworld", label: "Leave the Crypt", color: 0x4aa0ff },
    ],
  },
};
