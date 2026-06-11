// ===========================================================
// World / Zone system.
// A Zone builds terrain (or dungeon floor), scenery, lighting,
// portals and colliders from a config object (see zones.js).
// The "active" ground-height function is published so the
// player & enemies can stay grounded in whichever zone is loaded.
// ===========================================================
import * as THREE from "three";

export const WORLD_SIZE = 220;     // half-extent for outdoor zones
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
