// ===========================================================
// World / Zone system.
// A Zone builds terrain (or dungeon floor), scenery, lighting,
// portals and colliders from a config object (see zones.js).
// The "active" ground-height function is published so the
// player & enemies can stay grounded in whichever zone is loaded.
// ===========================================================
import * as THREE from "three";
import {
  sampleHeight, sampleColor, regionAt, cellOf, cellCenter,
  CELL, GRID, WORLD_HALF, SEA_LEVEL, startSpawn,
} from "./regions.js";

export const WORLD_SIZE = 220;     // half-extent for legacy outdoor zones
const SEG = 120;

// ---- active ground height (set by the loaded zone) ----
let activeHeight = () => 0;
export function groundHeight(x, z) { return activeHeight(x, z); }
export function setActiveHeight(fn) { activeHeight = fn; }

// Deterministic value-noise factory.
function makeNoise(seed = 1337) {
  const rand = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453;
    return n - Math.floor(n);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const tl = rand(xi, yi), tr = rand(xi + 1, yi);
    const bl = rand(xi, yi + 1), br = rand(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
  };
}

// Build a height function for an outdoor zone config.
export function makeTerrainHeight(cfg) {
  const noise = makeNoise(cfg.seed || 1337);
  const amp = cfg.amplitude ?? 26;
  return (x, z) => {
    const f1 = noise(x * 0.012 + 10, z * 0.012 + 10) - 0.5;
    const f2 = noise(x * 0.04 + 50, z * 0.04 + 50) - 0.5;
    const f3 = noise(x * 0.11 + 99, z * 0.11 + 99) - 0.5;
    let h = f1 * amp + f2 * 7 + f3 * 2.2;
    if (cfg.flattenCenter) {
      const d = Math.sqrt(x * x + z * z);
      const flat = THREE.MathUtils.clamp(1 - d / 28, 0, 1);
      h = THREE.MathUtils.lerp(h, 1.2, flat * flat);
    }
    return h;
  };
}

export class Zone {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.colliders = [];        // {x,z,r}
    this.portals = [];          // {x,z,r,to,label,mesh}
    this.objects = [];          // everything we added (for disposal)
    this.lights = [];
    if (config.type === "dungeon") {
      this.height = () => config.floorY ?? 0;
      setActiveHeight(this.height);
      this._buildDungeon();
    } else {
      this.height = makeTerrainHeight(config);
      setActiveHeight(this.height);
      this._buildOutdoor();
    }
    this._buildPortals();
  }

  _add(obj) { this.scene.add(obj); this.objects.push(obj); return obj; }

  // ----------------------------------------------------------------
  _buildOutdoor() {
    const scene = this.scene, cfg = this.config;
    scene.background = new THREE.Color(cfg.sky);
    scene.fog = new THREE.Fog(cfg.fog ?? cfg.sky, 90, 230);

    const sun = new THREE.DirectionalLight(cfg.sunColor ?? 0xfff2d6, cfg.sunIntensity ?? 1.5);
    sun.position.set(60, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 340; sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130;
    sun.shadow.bias = -0.0004;
    this._add(sun); this.lights.push(sun);
    this._add(new THREE.HemisphereLight(cfg.hemiSky ?? 0xbcd6ff, cfg.hemiGround ?? 0x4a6a3a, 0.7));
    this._add(new THREE.AmbientLight(0x40506a, 0.4));

    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 16),
      new THREE.MeshBasicMaterial({ color: cfg.sunDisc ?? 0xfff4c0 }));
    sunDisc.position.set(140, 150, -120);
    this._add(sunDisc);

    // terrain
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 2, WORLD_SIZE * 2, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const noise = makeNoise((cfg.seed || 1337) + 7);
    const low = new THREE.Color(cfg.colLow ?? 0xb8a878);
    const grass = new THREE.Color(cfg.colGrass ?? 0x5a8c3a);
    const grassDark = new THREE.Color(cfg.colGrassDark ?? 0x3d6b28);
    const rock = new THREE.Color(cfg.colRock ?? 0x6b6256);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.height(x, z);
      pos.setY(i, y);
      let c;
      if (y < 0.2) c = low.clone();
      else if (y > 13) c = rock.clone();
      else c = grass.clone().lerp(grassDark, noise(x * 0.2, z * 0.2));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    terrain.receiveShadow = true;
    this._add(terrain);

    if (cfg.water !== false) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE * 2, WORLD_SIZE * 2),
        new THREE.MeshStandardMaterial({ color: cfg.waterColor ?? 0x2f6f9f, transparent: true, opacity: 0.78, roughness: 0.2, metalness: 0.3 }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = cfg.waterY ?? -2.2;
      this._add(water);
      this.water = water;
    }

    this._scatterTrees(cfg.trees ?? 150);
    this._scatterRocks(cfg.rocks ?? 60);
    if (cfg.flowers !== false) this._scatterFlowers(cfg.flowers ?? 180, cfg.flowerColors);
    if (cfg.hamlet) this._buildHamlet();
  }

  _ground(obj, x, z, yOff = 0) { obj.position.set(x, this.height(x, z) + yOff, z); }

  _scatterTrees(n) {
    const cfg = this.config;
    const trunkMat = new THREE.MeshStandardMaterial({ color: cfg.trunkColor ?? 0x5a3a1c, roughness: 1, flatShading: true });
    const leafColors = cfg.leafColors ?? [0x2f7a32, 0x3d8c3a, 0x4a9c45, 0x6aa030];
    const leafMats = leafColors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 4, 6);
    const coneGeo = new THREE.ConeGeometry(2.6, 4.5, 7);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * (WORLD_SIZE - 40);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.height(x, z);
      if (y < 0.3 || y > 14) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 2; trunk.castShadow = true; tree.add(trunk);
      const lm = leafMats[(Math.random() * leafMats.length) | 0];
      if (cfg.deadTrees) {
        for (let k = 0; k < 4; k++) {
          const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2, 5), trunkMat);
          branch.position.set((Math.random()-0.5)*1.5, 4 + k, (Math.random()-0.5)*1.5);
          branch.rotation.z = (Math.random()-0.5)*1.5; tree.add(branch);
        }
      } else {
        for (let k = 0; k < 3; k++) {
          const cone = new THREE.Mesh(coneGeo, lm);
          cone.position.y = 4 + k * 1.8; cone.scale.setScalar(1 - k * 0.22); cone.castShadow = true; tree.add(cone);
        }
      }
      const sc = 0.8 + Math.random() * 0.8;
      tree.scale.setScalar(sc);
      tree.position.set(x, y, z);
      tree.rotation.y = Math.random() * Math.PI;
      this._add(tree);
      this.colliders.push({ x, z, r: 1.2 * sc });
    }
  }

  _scatterRocks(n) {
    const rockMat = new THREE.MeshStandardMaterial({ color: this.config.colRock ?? 0x6a6256, roughness: 1, flatShading: true });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 25 + Math.random() * (WORLD_SIZE - 30);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.height(x, z);
      if (y < 0.2) continue;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + Math.random() * 1.6, 0), rockMat);
      rock.position.set(x, y + 0.3, z);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.scale.y *= 0.7; rock.castShadow = true; rock.receiveShadow = true;
      this._add(rock);
      if (rock.geometry.parameters.radius > 1) this.colliders.push({ x, z, r: 1.4 });
    }
  }

  _scatterFlowers(n, palette) {
    const colors = palette ?? [0xffe14a, 0xff5a7a, 0xffffff, 0x9a6aff];
    const geo = new THREE.PlaneGeometry(0.5, 0.5);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * (WORLD_SIZE - 10);
      const z = (Math.random() * 2 - 1) * (WORLD_SIZE - 10);
      const y = this.height(x, z);
      if (y < 0.4 || y > 12) continue;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: colors[(Math.random() * colors.length) | 0], side: THREE.DoubleSide, roughness: 1 }));
      m.position.set(x, y + 0.25, z); m.rotation.y = Math.random() * Math.PI;
      this._add(m);
    }
  }

  _buildHamlet() {
    const spots = [[14, 8], [-15, 10], [10, -16], [-12, -14], [20, -2], [-22, -4]];
    for (const [x, z] of spots) this._house(x, z);
    const well = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 1, 12), new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 1, flatShading: true }));
    base.castShadow = true; base.receiveShadow = true; well.add(base);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0x2f6f9f, transparent: true, opacity: 0.8 }));
    w.position.y = 0.5; well.add(w);
    this._ground(well, 0, 0, 0.4);
    this._add(well);
    this.colliders.push({ x: 0, z: 0, r: 2.4 });
  }

  _house(x, z) {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 1, flatShading: true });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a4326, roughness: 1, flatShading: true });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 1, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), wallMat); body.position.y = 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    for (const [bx, bz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), woodMat); beam.position.set(bx, 2, bz); g.add(beam);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 3, 4), roofMat); roof.position.y = 5.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.2), woodMat); door.position.set(0, 1.2, 3.05); g.add(door);
    g.rotation.y = Math.atan2(-x, -z);
    this._ground(g, x, z, 0);
    this._add(g);
    this.colliders.push({ x, z, r: 4.2 });
  }

  // ----------------------------------------------------------------
  _buildDungeon() {
    const scene = this.scene, cfg = this.config;
    scene.background = new THREE.Color(cfg.sky ?? 0x0a0810);
    scene.fog = new THREE.Fog(cfg.fog ?? 0x0a0810, 14, 70);
    this._add(new THREE.AmbientLight(0x202838, 0.5));
    this._add(new THREE.HemisphereLight(0x223044, 0x0a0a10, 0.4));

    const W = cfg.width ?? 26, L = cfg.length ?? 120;
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 1, flatShading: true });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c1822, roughness: 1, flatShading: true });

    // floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 1, L), floorMat);
    floor.position.set(0, -0.5, -L / 2 + 10); floor.receiveShadow = true;
    this._add(floor);
    // ceiling
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 1, L), wallMat);
    ceil.position.set(0, 9, -L / 2 + 10); this._add(ceil);
    // side walls
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 10, L), wallMat);
      wall.position.set(sx * W / 2, 4, -L / 2 + 10); wall.receiveShadow = true; this._add(wall);
      this.colliders.push({ x: sx * W / 2, z: 0, r: 0.6, wall: true, axis: "x", at: sx * (W/2 - 0.5) });
    }
    // end caps
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, 10, 1), wallMat); back.position.set(0, 4, 10); this._add(back);
    const front = new THREE.Mesh(new THREE.BoxGeometry(W, 10, 1), wallMat); front.position.set(0, 4, -L + 10); this._add(front);

    // pillars + braziers down the hall
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x15121b, roughness: 1, flatShading: true });
    for (let z = 0; z > -L + 16; z -= 16) {
      for (const sx of [-1, 1]) {
        const px = sx * (W / 2 - 2);
        const pil = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 2), pillarMat); pil.position.set(px, 4, z); this._add(pil);
        this.colliders.push({ x: px, z, r: 1.6 });
        // brazier light
        const fire = new THREE.PointLight(0xff7a2a, 2.2, 22); fire.position.set(px - sx, 5.5, z); this._add(fire); this.lights.push(fire);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffae40 }));
        flame.position.set(px - sx, 5.6, z); this._add(flame); flame.userData.flicker = fire;
      }
    }
    this._flames = this.objects.filter(o => o.userData && o.userData.flicker);

    // boss dais at the far end
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1, 16), new THREE.MeshStandardMaterial({ color: 0x3a1230, roughness: 1, flatShading: true }));
    dais.position.set(0, 0, -L + 22); this._add(dais);
    const eerie = new THREE.PointLight(0x9a40ff, 2.5, 30); eerie.position.set(0, 6, -L + 22); this._add(eerie); this.lights.push(eerie);
    this.bossSpot = new THREE.Vector3(0, 0, -L + 22);
    this.dungeonLength = L;
    this.dungeonWidth = W;
  }

  _buildPortals() {
    for (const pcfg of (this.config.portals || [])) {
      const g = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({ color: pcfg.color ?? 0x9a40ff });
      const torus = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.3, 10, 24), ringMat);
      torus.rotation.x = Math.PI / 2; torus.position.y = 2.2; g.add(torus);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24),
        new THREE.MeshBasicMaterial({ color: pcfg.color ?? 0x9a40ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
      disc.position.y = 2.2; disc.rotation.x = 0; g.add(disc);
      const light = new THREE.PointLight(pcfg.color ?? 0x9a40ff, 3, 16); light.position.y = 2.5; g.add(light);
      const y = this.height(pcfg.x, pcfg.z);
      g.position.set(pcfg.x, y, pcfg.z);
      this._add(g);
      this.portals.push({ x: pcfg.x, z: pcfg.z, y, r: pcfg.r ?? 3, to: pcfg.to, label: pcfg.label, mesh: g, disc, color: pcfg.color });
    }
  }

  // collide against prop circles + outer bounds (+ dungeon walls)
  resolveCollision(x, z, radius = 0.6) {
    for (const c of this.colliders) {
      if (c.wall) continue;
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d < min && d > 0.0001) { const push = min - d; x += (dx / d) * push; z += (dz / d) * push; }
    }
    if (this.config.type === "dungeon") {
      const halfW = this.dungeonWidth / 2 - 0.8;
      x = THREE.MathUtils.clamp(x, -halfW, halfW);
      z = THREE.MathUtils.clamp(z, -this.dungeonLength + 11, 8);
    } else {
      x = THREE.MathUtils.clamp(x, -WORLD_SIZE + 4, WORLD_SIZE - 4);
      z = THREE.MathUtils.clamp(z, -WORLD_SIZE + 4, WORLD_SIZE - 4);
    }
    return [x, z];
  }

  update(t) {
    if (this.water) this.water.material.opacity = 0.72 + Math.sin(t * 1.5) * 0.06;
    for (const p of this.portals) { p.mesh.rotation.y = t * 0.6; if (p.disc) p.disc.material.opacity = 0.35 + Math.sin(t * 3) * 0.12; }
    if (this._flames) for (const f of this._flames) { const s = 0.85 + Math.sin(t * 12 + f.position.x) * 0.15; f.scale.setScalar(s); f.userData.flicker.intensity = 2 + Math.sin(t * 18 + f.position.z) * 0.6; }
  }

  // spawn an extra portal at runtime (e.g. boss-drop exit)
  addPortal(pcfg) {
    const saved = this.config.portals;
    this.config.portals = [pcfg];
    this._buildPortals();
    this.config.portals = saved;
    return this.portals[this.portals.length - 1];
  }

  dispose() {
    for (const o of this.objects) {
      this.scene.remove(o);
      o.traverse?.(c => { if (c.isMesh) { c.geometry?.dispose?.(); } });
    }
    this.objects = []; this.colliders = []; this.portals = [];
  }
}

// ===========================================================
// Overworld — one seamless streamed continent.
// Loads a 3x3 ring of terrain chunks around the player; each
// chunk samples the global biome height/color and scatters
// region-appropriate props. Creatures are spawned/despawned
// per-chunk via callbacks so only ~9 cells are ever active.
// ===========================================================
function smat(c, o = {}) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: o.rough ?? 1, metalness: o.metal ?? 0, flatShading: true, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: o.transparent ?? false, opacity: o.opacity ?? 1 });
}

// ---- tree / prop builders by biome kind ----
function buildTree(kind, leafColors, trunkColor) {
  const g = new THREE.Group();
  const lc = leafColors[(Math.random() * leafColors.length) | 0];
  const trunkMat = smat(trunkColor);
  const leafMat = smat(lc);
  if (kind === "dead") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 5, 6), trunkMat);
    trunk.position.y = 2.5; g.add(trunk);
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2, 5), trunkMat); b.position.set((Math.random()-0.5)*1.6, 3.5 + k*0.6, (Math.random()-0.5)*1.6); b.rotation.z = (Math.random()-0.5)*1.6; g.add(b); }
  } else if (kind === "crystal") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.4, 2, 6), trunkMat); trunk.position.y = 1; g.add(trunk);
    for (let k = 0; k < 5; k++) { const sh = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.4, 5), smat(lc, { emissive: lc, ei: 0.5, transparent: true, opacity: 0.85 })); sh.position.set((Math.random()-0.5)*1.2, 2 + Math.random()*1.5, (Math.random()-0.5)*1.2); sh.rotation.set(Math.random()*0.5, 0, (Math.random()-0.5)*0.6); g.add(sh); }
  } else if (kind === "palm") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 5.5, 6), trunkMat); trunk.position.y = 2.75; trunk.rotation.z = 0.12; g.add(trunk);
    for (let k = 0; k < 6; k++) { const frond = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.6), leafMat); frond.position.set(0, 5.4, 0); frond.rotation.y = (k / 6) * Math.PI * 2; frond.rotation.z = 0.4; frond.position.x = Math.cos(frond.rotation.y) * 1.3; frond.position.z = Math.sin(frond.rotation.y) * 1.3; g.add(frond); }
  } else if (kind === "willow") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3.5, 6), trunkMat); trunk.position.y = 1.75; g.add(trunk);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), leafMat); canopy.position.y = 4; canopy.scale.y = 0.7; g.add(canopy);
    for (let k = 0; k < 6; k++) { const drape = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2), leafMat); const a = Math.random()*Math.PI*2; drape.position.set(Math.cos(a)*1.8, 2.6, Math.sin(a)*1.8); g.add(drape); }
  } else if (kind === "round") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 3, 6), trunkMat); trunk.position.y = 1.5; g.add(trunk);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 0), leafMat); ball.position.y = 4; g.add(ball);
  } else if (kind === "autumn") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3.5, 6), trunkMat); trunk.position.y = 1.75; g.add(trunk);
    for (let k = 0; k < 3; k++) { const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 - k*0.2, 0), smat(leafColors[(Math.random()*leafColors.length)|0])); ball.position.set((Math.random()-0.5)*1.2, 4 + k*0.9, (Math.random()-0.5)*1.2); g.add(ball); }
  } else if (kind === "jungle") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 7, 6), trunkMat); trunk.position.y = 3.5; g.add(trunk);
    for (let k = 0; k < 3; k++) { const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - k*0.5, 2.6 - k*0.5, 0.5, 7), leafMat); disc.position.y = 6 + k*1.1; g.add(disc); }
  } else { // pine
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 4, 6), trunkMat); trunk.position.y = 2; g.add(trunk);
    for (let k = 0; k < 3; k++) { const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4.5, 7), leafMat); cone.position.y = 4 + k*1.8; cone.scale.setScalar(1 - k*0.22); g.add(cone); }
  }
  return g;
}

export class Overworld {
  constructor(scene, callbacks = {}, opts = {}) {
    this.scene = scene;
    this.cb = callbacks;            // {onSpawnChunk, onDespawnChunk}
    this.mobile = !!opts.mobile;    // lighter prop/shadow budget on phones
    this.chunks = new Map();        // key -> {objects, colliders, portals}
    this.colliders = [];            // aggregate (rebuilt on chunk change)
    this.portals = [];              // aggregate
    this.loadRadius = 1;            // 3x3
    this._lastCell = null;
    setActiveHeight(sampleHeight);
    this.height = sampleHeight;
    this._buildSkyAndSea();
  }

  _buildSkyAndSea() {
    const scene = this.scene;
    scene.background = new THREE.Color(0x9fc0e4);
    scene.fog = new THREE.Fog(0x9fc0e4, 180, 520);

    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
    this.sun.castShadow = !this.mobile;
    this.sun.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 260; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4a6a3a, 0.7); scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0x40506a, 0.4); scene.add(this.amb);

    // global sea
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2 + 400, WORLD_HALF * 2 + 400),
      new THREE.MeshStandardMaterial({ color: 0x2f6f9f, transparent: true, opacity: 0.8, roughness: 0.2, metalness: 0.35 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = SEA_LEVEL - 0.4;
    scene.add(sea); this.sea = sea;
  }

  _chunkKey(cx, cz) { return cx + "," + cz; }

  _buildChunk(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID) return;
    const key = this._chunkKey(cx, cz);
    if (this.chunks.has(key)) return;
    const region = regionAt(cx, cz);
    const [ccx, ccz] = cellCenter(cx, cz);
    const chunk = { objects: [], colliders: [], portals: [] };

    // terrain mesh
    const SEG = 40;
    const geo = new THREE.PlaneGeometry(CELL, CELL, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + ccx, wz = pos.getZ(i) + ccz;
      const y = sampleHeight(wx, wz);
      pos.setY(i, y);
      sampleColor(wx, wz, y, col);
      colors.push(col.r, col.g, col.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    terrain.position.set(ccx, 0, ccz);
    terrain.receiveShadow = true;
    this.scene.add(terrain); chunk.objects.push(terrain);

    // props
    this._scatterProps(chunk, region, ccx, ccz);
    if (region.hamlet) this._buildHamlet(chunk, ccx, ccz);
    if (region.dungeon) this._addPortal(chunk, ccx + 60, ccz + 60, region.dungeon, "Enter Shadowfang Crypt", 0x9a40ff);

    this.chunks.set(key, chunk);
    // notify spawner
    this.cb.onSpawnChunk?.(key, region, cx, cz);
  }

  _scatterProps(chunk, region, ccx, ccz) {
    const half = CELL / 2 - 6;
    const treeCount = Math.round((region.trees || 0) * (this.mobile ? 0.4 : 0.7));
    for (let i = 0; i < treeCount; i++) {
      const x = ccx + (Math.random() * 2 - 1) * half;
      const z = ccz + (Math.random() * 2 - 1) * half;
      const y = sampleHeight(x, z);
      if (y < SEA_LEVEL + 0.4 || y > 26) continue;
      const tree = buildTree(region.treeKind, region.leaf, region.trunk || 0x5a3a1c);
      const sc = 0.8 + Math.random() * 0.7;
      tree.scale.setScalar(sc); tree.position.set(x, y, z); tree.rotation.y = Math.random() * Math.PI;
      this.scene.add(tree); chunk.objects.push(tree);
      chunk.colliders.push({ x, z, r: 1.1 * sc });
    }
    const rockMat = smat(region.colRock || 0x6a6256);
    for (let i = 0; i < (region.rocks || 0); i++) {
      const x = ccx + (Math.random() * 2 - 1) * half;
      const z = ccz + (Math.random() * 2 - 1) * half;
      const y = sampleHeight(x, z);
      if (y < SEA_LEVEL + 0.2) continue;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + Math.random() * 1.8, 0), rockMat);
      rk.position.set(x, y + 0.3, z); rk.rotation.set(Math.random(), Math.random(), Math.random()); rk.scale.y *= 0.7;
      rk.castShadow = true; rk.receiveShadow = true;
      this.scene.add(rk); chunk.objects.push(rk);
      if (rk.geometry.parameters.radius > 1.1) chunk.colliders.push({ x, z, r: 1.3 });
    }
    if (region.flowers && !this.mobile) {
      const fc = [0xffe14a, 0xff5a7a, 0xffffff, 0x9a6aff];
      const fgeo = new THREE.PlaneGeometry(0.5, 0.5);
      for (let i = 0; i < 120; i++) {
        const x = ccx + (Math.random()*2-1)*half, z = ccz + (Math.random()*2-1)*half;
        const y = sampleHeight(x, z); if (y < SEA_LEVEL + 0.5) continue;
        const m = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({ color: fc[(Math.random()*fc.length)|0], side: THREE.DoubleSide, roughness: 1 }));
        m.position.set(x, y + 0.25, z); m.rotation.y = Math.random()*Math.PI;
        this.scene.add(m); chunk.objects.push(m);
      }
    }
  }

  _buildHamlet(chunk, ccx, ccz) {
    const spots = [[14, 8], [-15, 10], [10, -16], [-12, -14], [20, -2], [-22, -4]];
    for (const [dx, dz] of spots) this._house(chunk, ccx + dx, ccz + dz, ccx, ccz);
    const well = new THREE.Group();
    well.add(new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 1, 12), smat(0x8a8276)));
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0x2f6f9f, transparent: true, opacity: 0.8 }));
    w.position.y = 0.5; well.add(w);
    well.position.set(ccx, sampleHeight(ccx, ccz) + 0.4, ccz);
    this.scene.add(well); chunk.objects.push(well);
    chunk.colliders.push({ x: ccx, z: ccz, r: 2.4 });
  }

  _house(chunk, x, z, cx, cz) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), smat(0xc9b58a)); body.position.y = 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    for (const [bx, bz] of [[-3,-3],[3,-3],[3,3],[-3,3]]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4,4,0.4), smat(0x6a4326)); beam.position.set(bx,2,bz); g.add(beam); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 3, 4), smat(0x8a3a2a)); roof.position.y = 5.5; roof.rotation.y = Math.PI/4; roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.2), smat(0x6a4326)); door.position.set(0, 1.2, 3.05); g.add(door);
    g.rotation.y = Math.atan2(cx - x, cz - z);
    g.position.set(x, sampleHeight(x, z), z);
    this.scene.add(g); chunk.objects.push(g);
    chunk.colliders.push({ x, z, r: 4.2 });
  }

  _addPortal(chunk, x, z, to, label, color) {
    const g = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.3, 10, 24), new THREE.MeshBasicMaterial({ color }));
    torus.rotation.x = Math.PI / 2; torus.position.y = 2.2; g.add(torus);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    disc.position.y = 2.2; g.add(disc);
    const light = new THREE.PointLight(color, 3, 16); light.position.y = 2.5; g.add(light);
    const y = sampleHeight(x, z); g.position.set(x, y, z);
    this.scene.add(g); chunk.objects.push(g);
    const portal = { x, z, y, r: 3, to, label, mesh: g, disc, color };
    chunk.portals.push(portal);
  }

  _disposeChunk(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    for (const o of chunk.objects) {
      this.scene.remove(o);
      o.traverse?.(c => { if (c.isMesh) { c.geometry?.dispose?.(); } });
    }
    this.chunks.delete(key);
    this.cb.onDespawnChunk?.(key);
  }

  _rebuildAggregates() {
    this.colliders = [];
    this.portals = [];
    for (const chunk of this.chunks.values()) {
      for (const c of chunk.colliders) this.colliders.push(c);
      for (const p of chunk.portals) this.portals.push(p);
    }
  }

  _stream(px, pz) {
    const [cx, cz] = cellOf(px, pz);
    if (this._lastCell && this._lastCell[0] === cx && this._lastCell[1] === cz) return;
    this._lastCell = [cx, cz];
    const want = new Set();
    for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++)
      for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
        want.add(this._chunkKey(nx, nz));
      }
    // unload far
    for (const key of [...this.chunks.keys()]) if (!want.has(key)) this._disposeChunk(key);
    // load near
    for (const key of want) if (!this.chunks.has(key)) { const [a, b] = key.split(",").map(Number); this._buildChunk(a, b); }
    this._rebuildAggregates();
  }

  resolveCollision(x, z, radius = 0.6) {
    for (const c of this.colliders) {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = c.r + radius;
      if (d < min && d > 0.0001) { const push = min - d; x += (dx / d) * push; z += (dz / d) * push; }
    }
    const lim = WORLD_HALF - 6;
    x = THREE.MathUtils.clamp(x, -lim, lim);
    z = THREE.MathUtils.clamp(z, -lim, lim);
    return [x, z];
  }

  update(t, player) {
    if (player) {
      this._stream(player.position.x, player.position.z);
      // sun follows player for crisp local shadows
      this.sun.position.set(player.position.x + 60, player.position.y + 120, player.position.z + 40);
      this.sun.target.position.copy(player.position);
    }
    if (this.sea) this.sea.material.opacity = 0.74 + Math.sin(t * 1.2) * 0.05;
    for (const p of this.portals) { p.mesh.rotation.y = t * 0.6; if (p.disc) p.disc.material.opacity = 0.35 + Math.sin(t * 3) * 0.12; }
  }

  dispose() {
    for (const key of [...this.chunks.keys()]) this._disposeChunk(key);
    for (const o of [this.sun, this.sun?.target, this.hemi, this.amb, this.sea]) if (o) this.scene.remove(o);
    this.colliders = []; this.portals = [];
  }
}
