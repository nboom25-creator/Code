// ===========================================================
// Creature factory: a handful of procedural body builders plus
// a registry of unique creatures themed per region.
// Each creature is data; models are built from its body type.
// ===========================================================
import * as THREE from "three";

function mat(c, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: c, roughness: opts.rough ?? 0.9, metalness: opts.metal ?? 0.05,
    flatShading: true, emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
  });
}

// ---------- body builders ----------
function buildQuad(d) {
  const g = new THREE.Group();
  const c = d.color, c2 = d.color2 ?? c;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.9), mat(c));
  body.position.y = 0.95; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(c2));
  head.position.set(1.0, 1.05, 0); head.castShadow = true; g.add(head);
  if (d.horns) for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), mat(0xe8e0d0));
    horn.position.set(1.1, 1.5, sx * 0.2); horn.rotation.z = -0.5; g.add(horn);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.16), mat(c2));
  tail.position.set(-1.0, 1.05, 0); g.add(tail);
  const legs = [];
  for (const [sx, sz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), mat(c2));
    leg.position.set(sx, 0.35, sz); leg.castShadow = true; g.add(leg); legs.push(leg);
  }
  g.userData = { bodyType: "quad", legs };
  return g;
}

function buildBiped(d) {
  const g = new THREE.Group();
  const c = d.color, skin = d.color2 ?? 0x9a7a50;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), mat(c));
  torso.position.y = 1.4; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat(skin));
  head.position.y = 2.05; head.castShadow = true; g.add(head);
  if (d.glow) {
    const eMat = mat(d.glow, { emissive: d.glow, emissiveIntensity: 1.6 });
    for (const ex of [-1, 1]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eMat); eye.position.set(ex * 0.1, 2.07, 0.22); g.add(eye); }
  }
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.18), mat(c)); armL.position.set(-0.5, 1.35, 0); armL.castShadow = true; g.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.18), mat(c)); armR.position.set(0.5, 1.35, 0); armR.castShadow = true; g.add(armR);
  const legs = [];
  for (const sx of [-0.2, 0.2]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.22), mat(0x3a2f20)); leg.position.set(sx, 0.5, 0); leg.castShadow = true; g.add(leg); legs.push(leg); }
  // weapon for raiders
  if (d.armed) {
    const wpn = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), mat(0xcfd6dd));
    wpn.position.set(0.5, 1.1, 0.2); armR.add(wpn);
  }
  g.userData = { bodyType: "biped", legs, arms: [armL, armR] };
  return g;
}

function buildSerpent(d) {
  const g = new THREE.Group();
  const c = d.color, c2 = d.color2 ?? c;
  const segs = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const r = 0.5 * (1 - i / (n + 2));
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), mat(i % 2 ? c : c2));
    seg.position.set(-i * 0.55, 0.6, 0); seg.scale.setScalar(Math.max(0.4, 1 - i * 0.12)); seg.castShadow = true;
    g.add(seg); segs.push(seg);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.6), mat(c));
  head.position.set(0.5, 0.75, 0); head.castShadow = true; g.add(head);
  if (d.glow) { const eMat = mat(d.glow, { emissive: d.glow, emissiveIntensity: 1.6 }); for (const ex of [-1,1]) { const eye=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.05),eMat); eye.position.set(0.75,0.85,ex*0.18); g.add(eye); } }
  g.userData = { bodyType: "serpent", segs };
  return g;
}

function buildFlyer(d) {
  const g = new THREE.Group();
  const c = d.color, c2 = d.color2 ?? c;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), mat(c));
  body.scale.set(1, 0.8, 1.4); body.position.y = 1.6; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(c2));
  head.position.set(0, 1.75, 0.6); g.add(head);
  if (d.glow) { const eMat = mat(d.glow, { emissive: d.glow, emissiveIntensity: 1.6 }); for (const ex of [-1,1]) { const eye=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,0.05),eMat); eye.position.set(ex*0.12,1.8,0.78); g.add(eye); } }
  const wings = [];
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.8), mat(c2, { transparent: d.membrane, opacity: d.membrane ? 0.8 : 1 }));
    wing.position.set(sx * 0.9, 1.7, 0); wing.castShadow = true; g.add(wing); wings.push(wing);
  }
  // dangling legs
  for (const sx of [-0.2, 0.2]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), mat(c2)); leg.position.set(sx, 1.2, 0); g.add(leg); }
  g.userData = { bodyType: "flyer", wings };
  return g;
}

function buildBlob(d) {
  const g = new THREE.Group();
  const c = d.color;
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1),
    mat(c, { transparent: true, opacity: 0.85, emissive: d.glow ?? c, emissiveIntensity: 0.4, rough: 0.4 }));
  body.position.y = 0.9; body.castShadow = true; g.add(body);
  // inner core
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat(d.glow ?? 0xffffff, { emissive: d.glow ?? 0xffffff, emissiveIntensity: 1.4 }));
  core.position.y = 0.9; g.add(core);
  if (d.glow) { const l = new THREE.PointLight(d.glow, 1.2, 7); l.position.y = 1; g.add(l); }
  g.userData = { bodyType: "blob", body };
  return g;
}

function buildGolem(d) {
  const g = new THREE.Group();
  const c = d.color, c2 = d.color2 ?? c;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.4, 0.9), mat(c, { rough: 1 }));
  torso.position.y = 2.2; torso.castShadow = true; g.add(torso);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), mat(d.glow ?? 0xff8020, { emissive: d.glow ?? 0xff8020, emissiveIntensity: 1.6 }));
  core.position.set(0, 2.3, 0.5); g.add(core);
  if (d.glow) { const l = new THREE.PointLight(d.glow, 1.5, 8); l.position.set(0, 2.3, 0.6); g.add(l); }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), mat(c2)); head.position.y = 3.2; head.castShadow = true; g.add(head);
  const arms = [];
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), mat(c2)); arm.position.set(sx * 1.0, 2.1, 0); arm.castShadow = true; g.add(arm); arms.push(arm); }
  const legs = [];
  for (const sx of [-0.45, 0.45]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.4, 0.55), mat(c)); leg.position.set(sx, 0.75, 0); leg.castShadow = true; g.add(leg); legs.push(leg); }
  g.userData = { bodyType: "golem", legs, arms };
  return g;
}

function buildInsect(d) {
  const g = new THREE.Group();
  const c = d.color, c2 = d.color2 ?? c;
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), mat(c, { metal: 0.3, rough: 0.5 }));
  abdomen.position.set(-0.5, 0.7, 0); abdomen.castShadow = true; g.add(abdomen);
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), mat(c2, { metal: 0.3, rough: 0.5 }));
  thorax.position.set(0.4, 0.65, 0); thorax.castShadow = true; g.add(thorax);
  for (const sx of [-1, 1]) {
    const pincer = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), mat(c2));
    pincer.position.set(0.9, 0.6, sx * 0.25); pincer.rotation.z = Math.PI / 2; g.add(pincer);
  }
  const legs = [];
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), mat(0x222222));
    leg.position.set(-0.2 + i * 0.4, 0.35, sx * 0.5); leg.rotation.x = sx * 0.4; g.add(leg); legs.push(leg);
  }
  g.userData = { bodyType: "insect", legs };
  return g;
}

const BUILDERS = { quad: buildQuad, biped: buildBiped, serpent: buildSerpent, flyer: buildFlyer, blob: buildBlob, golem: buildGolem, insect: buildInsect };

export function buildCreature(def) {
  const model = (BUILDERS[def.body] || buildQuad)(def);
  model.scale.setScalar(def.scale ?? 1);
  return model;
}

export function animateBody(model, { moving, t, swing = 0 }) {
  const u = model.userData;
  switch (u.bodyType) {
    case "quad": case "insect":
      if (u.legs) { const sw = moving ? Math.sin(t * 11) * 0.5 : 0; u.legs.forEach((l, i) => l.rotation.x = (i % 2 ? sw : -sw)); }
      break;
    case "biped": case "golem":
      if (u.legs) { const sw = moving ? Math.sin(t * 9) * 0.6 : THREE.MathUtils.lerp(u.legs[0].rotation.x, 0, 0.1); u.legs.forEach((l, i) => l.rotation.x = (i % 2 ? sw : -sw)); }
      if (u.arms && swing > 0) u.arms[1].rotation.x = -2 * swing;
      else if (u.arms) u.arms[1].rotation.x = THREE.MathUtils.lerp(u.arms[1].rotation.x, 0, 0.2);
      break;
    case "flyer":
      if (u.wings) { const f = Math.sin(t * 16) * 0.7; u.wings[0].rotation.z = f; u.wings[1].rotation.z = -f; }
      break;
    case "blob":
      if (u.body) { const s = 1 + Math.sin(t * 4) * 0.12; u.body.scale.set(s, 2 - s, s); }
      break;
    case "serpent":
      if (u.segs) u.segs.forEach((sg, i) => { sg.position.z = Math.sin(t * 4 - i * 0.6) * 0.4 * (moving ? 1 : 0.4); });
      break;
  }
}

// ===========================================================
// Creature registry — ~45 unique creatures across all regions.
// Defaults are filled per body type; per-creature opts tweak-override.
// ===========================================================
const BODY_DEFAULTS = {
  quad:    { hp: 50,  dmg: 6,  xp: 26, speed: 5.0, range: 2.2, aggro: 12 },
  biped:   { hp: 60,  dmg: 8,  xp: 34, speed: 4.6, range: 2.4, aggro: 13 },
  serpent: { hp: 55,  dmg: 9,  xp: 36, speed: 4.4, range: 2.6, aggro: 12 },
  flyer:   { hp: 45,  dmg: 8,  xp: 38, speed: 5.6, range: 2.4, aggro: 15, flying: true },
  blob:    { hp: 80,  dmg: 7,  xp: 30, speed: 3.2, range: 2.2, aggro: 10 },
  golem:   { hp: 160, dmg: 14, xp: 70, speed: 3.4, range: 3.0, aggro: 13, elite: true },
  insect:  { hp: 40,  dmg: 6,  xp: 24, speed: 5.0, range: 2.2, aggro: 12 },
};

function C(id, name, body, opts = {}) {
  const d = { id, name, body, ...BODY_DEFAULTS[body], ...opts };
  d.hostile = opts.hostile ?? "hostile";
  return d;
}

export const CREATURES = {
  // Whisperwood (forest, starter)
  boar:        C("boar", "Ridgeback Boar", "quad", { color: 0x6a4a30, color2: 0x4a3220, hostile: "neutral", hp: 42 }),
  stalker:     C("stalker", "Gray Stalker", "quad", { color: 0x55585f, color2: 0x3a3d42, speed: 5.6 }),
  treant:      C("treant", "Young Treant", "biped", { color: 0x4a6a2a, color2: 0x6a8a3a, elite: true, hp: 120, scale: 1.3 }),
  // Goldmeadow (plains)
  plainslion:  C("plainslion", "Plains Lion", "quad", { color: 0xc79a5a, color2: 0x8a6a3a, speed: 6.0 }),
  raptor:      C("raptor", "Swift Raptor", "quad", { color: 0x4a8a5a, color2: 0x2a5a3a, speed: 6.4, scale: 0.9 }),
  bandit:      C("bandit", "Highway Bandit", "biped", { color: 0x7a2a2a, armed: true }),
  // Wildgrove (autumn forest)
  stag:        C("stag", "Elder Stag", "quad", { color: 0x8a5a30, color2: 0x6a3a1a, horns: true, hostile: "neutral", hp: 70 }),
  direwolf:    C("direwolf", "Dire Wolf", "quad", { color: 0x3a3d42, color2: 0x202225, speed: 6.0, hp: 75 }),
  grizzly:     C("grizzly", "Grovewood Grizzly", "quad", { color: 0x5a3a22, color2: 0x3a2414, elite: true, hp: 160, scale: 1.4 }),
  // Thornmarsh (swamp)
  boglurker:   C("boglurker", "Bog Lurker", "blob", { color: 0x4a6a3a, glow: 0x9aff6a }),
  croc:        C("croc", "Marsh Crocolisk", "quad", { color: 0x3a5a3a, color2: 0x2a3a22, hp: 90, scale: 1.2 }),
  wisp:        C("wisp", "Will-o'-Wisp", "flyer", { color: 0xaaffcc, color2: 0x66ddaa, glow: 0x88ffbb, membrane: true, hp: 50 }),
  // Stormpeak (highlands)
  cragboar:    C("cragboar", "Crag Boar", "quad", { color: 0x6a6256, color2: 0x4a4438, hp: 80 }),
  gryphon:     C("gryphon", "Wild Gryphon", "flyer", { color: 0xc9a05a, color2: 0xe8d0a0, hp: 90, elite: true, scale: 1.3 }),
  stormelem:   C("stormelem", "Storm Elemental", "blob", { color: 0x88aaff, glow: 0xaaddff, hp: 110 }),
  // Mistral Coast (beach)
  sandcrab:    C("sandcrab", "Tidal Crab", "insect", { color: 0xd06a4a, color2: 0xa04a2a, hostile: "neutral" }),
  reefcrawler: C("reefcrawler", "Reef Crawler", "insect", { color: 0x4a8a8a, color2: 0x2a5a5a }),
  siren:       C("siren", "Coastal Siren", "biped", { color: 0x3a8aaa, color2: 0x8addee, glow: 0x88eeff, elite: true, hp: 130 }),
  // Verdant Jungle
  panther:     C("panther", "Shadow Panther", "quad", { color: 0x202028, color2: 0x101014, speed: 6.4 }),
  venomserp:   C("venomserp", "Venom Serpent", "serpent", { color: 0x3a8a3a, color2: 0x6aff6a, glow: 0xaaff44 }),
  headhunter:  C("headhunter", "Jungle Headhunter", "biped", { color: 0x5a8ab0, color2: 0x3a5a6a, armed: true, elite: true, hp: 140 }),
  // Frostspire (snow mountains)
  frostwolf:   C("frostwolf", "Frostfang Wolf", "quad", { color: 0xc8d8e8, color2: 0x9ab0c8, speed: 6.0 }),
  yeti:        C("yeti", "Frost Yeti", "biped", { color: 0xe8eef5, color2: 0xc0d0e0, elite: true, hp: 200, scale: 1.5 }),
  iceelem:     C("iceelem", "Ice Elemental", "blob", { color: 0x9adcff, glow: 0xddf6ff, hp: 130 }),
  // Ashen Badlands
  rockgolem:   C("rockgolem", "Boulder Golem", "golem", { color: 0x6a5a4a, color2: 0x4a3e30, glow: 0xff8020 }),
  vulture:     C("vulture", "Carrion Vulture", "flyer", { color: 0x5a4a3a, color2: 0x3a2e22, hp: 50 }),
  marauder:    C("marauder", "Badlands Marauder", "biped", { color: 0x8a5a2a, armed: true }),
  // Shadowmoor (cursed forest, dungeon access)
  shadowstalker:C("shadowstalker", "Shadow Stalker", "quad", { color: 0x2a2040, color2: 0x140e26, glow: 0xaa44ff, speed: 6.0 }),
  ghoul:       C("ghoul", "Rotting Ghoul", "biped", { color: 0x6a7a5a, color2: 0x8a9a7a, glow: 0x88ff44 }),
  wraith:      C("wraith", "Tormented Wraith", "flyer", { color: 0x2a1840, color2: 0x4a2860, glow: 0x80f0ff, membrane: true, hp: 95, scale: 1.1 }),
  // Crystalvale (magic crystals)
  manawyrm:    C("manawyrm", "Mana Wyrm", "serpent", { color: 0x6a40c0, color2: 0xc080ff, glow: 0xcc88ff, scale: 0.9 }),
  crystalgolem:C("crystalgolem", "Crystal Golem", "golem", { color: 0x7a6aff, color2: 0xaaa0ff, glow: 0x88ffff, hp: 200 }),
  arcanesprite:C("arcanesprite", "Arcane Sprite", "flyer", { color: 0xc080ff, color2: 0xe0b0ff, glow: 0xffaaff, membrane: true }),
  // Sunscorch Desert
  sandwurm:    C("sandwurm", "Sand Wurm", "serpent", { color: 0xc9a060, color2: 0xe8c890, hp: 120, scale: 1.3, elite: true }),
  scarab:      C("scarab", "Plague Scarab", "insect", { color: 0x3a6a3a, color2: 0x88cc44, glow: 0xaaff44 }),
  dustraider:  C("dustraider", "Dust Raider", "biped", { color: 0xb89050, color2: 0x8a6a30, armed: true }),
  // Emberfall Wastes (volcanic)
  lavahound:   C("lavahound", "Lava Hound", "quad", { color: 0x5a1a10, color2: 0xff5a1a, glow: 0xff6020, hp: 110 }),
  magmaelem:   C("magmaelem", "Magma Elemental", "blob", { color: 0x8a2010, glow: 0xff5010, hp: 150 }),
  scorchling:  C("scorchling", "Scorchling", "flyer", { color: 0xff7a2a, color2: 0xffc060, glow: 0xffaa30, hp: 60 }),
  // Bloodfen (red swamp)
  bloodleech:  C("bloodleech", "Giant Bloodleech", "serpent", { color: 0x7a1020, color2: 0xb02030, hp: 90 }),
  bogtroll:    C("bogtroll", "Bogfen Troll", "biped", { color: 0x4a6a4a, color2: 0x6a8a5a, elite: true, hp: 180, scale: 1.4 }),
  plaguerat:   C("plaguerat", "Plague Rat", "quad", { color: 0x5a4a3a, color2: 0x3a2e22, speed: 6.2, scale: 0.7 }),
  // Direhollow (haunted)
  skeleton:    C("skeleton", "Risen Skeleton", "biped", { color: 0xe8e2d0, color2: 0xe8e2d0, glow: 0xff3020 }),
  banshee:     C("banshee", "Wailing Banshee", "flyer", { color: 0x3a2a5a, color2: 0x6a4a8a, glow: 0xbbaaff, membrane: true, elite: true, hp: 160 }),
  direbat:     C("direbat", "Dire Bat", "flyer", { color: 0x2a2228, color2: 0x4a3a44, speed: 6.6 }),
  // The Maw (endgame)
  felhound:    C("felhound", "Fel Hound", "quad", { color: 0x4a1020, color2: 0x8a2040, glow: 0xff2060, speed: 6.4, hp: 220 }),
  demon:       C("demon", "Pit Demon", "golem", { color: 0x6a1020, color2: 0x3a0a14, glow: 0xff3010, hp: 400, dmg: 26 }),
  dreadlord:   C("dreadlord", "Lesser Dreadlord", "golem", { color: 0x3a0a30, color2: 0x6a1050, glow: 0xcc20ff, hp: 600, dmg: 32, scale: 1.3 }),

  // Dungeon-only
  cryptskeleton: C("cryptskeleton", "Crypt Skeleton", "biped", { color: 0xd8d2c0, color2: 0xd8d2c0, glow: 0xff3020, hp: 75 }),
  cryptwraith:   C("cryptwraith", "Crypt Wraith", "flyer", { color: 0x2a1840, color2: 0x4a2860, glow: 0x80f0ff, membrane: true, hp: 90 }),
  mortis:        C("mortis", "Lord Mortis", "golem", { color: 0x2a1030, color2: 0x6a1050, glow: 0x9a20ff, hp: 1600, dmg: 40, scale: 1.5, boss: true, aggro: 30, range: 4 }),
};

export function getCreature(id) { return CREATURES[id]; }
