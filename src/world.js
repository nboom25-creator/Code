// ===========================================================
// World: terrain, scenery, lighting, sky.
// WoW-style stylized outdoor zone — rolling green hills,
// trees, rocks, a path and a small starter hamlet.
// ===========================================================
import * as THREE from "three";

export const WORLD_SIZE = 220;     // half-extent in each direction
const SEG = 120;

// Deterministic value-noise for repeatable terrain.
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

const noise = makeNoise();

// Height function used by terrain + entity grounding.
export function terrainHeight(x, z) {
  const f1 = noise(x * 0.012 + 10, z * 0.012 + 10) - 0.5;
  const f2 = noise(x * 0.04 + 50, z * 0.04 + 50) - 0.5;
  const f3 = noise(x * 0.11 + 99, z * 0.11 + 99) - 0.5;
  let h = f1 * 26 + f2 * 7 + f3 * 2.2;
  // flatten a central plaza for the hamlet & spawn
  const d = Math.sqrt(x * x + z * z);
  const flat = THREE.MathUtils.clamp(1 - d / 28, 0, 1);
  h = THREE.MathUtils.lerp(h, 1.2, flat * flat);
  return h;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // {x,z,r} props you bump into
    this._build();
  }

  _build() {
    const scene = this.scene;

    // ---- Sky ----
    scene.background = new THREE.Color(0x8fb6e0);
    scene.fog = new THREE.Fog(0x9fc0e4, 90, 210);

    // ---- Lights ----
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
    sun.position.set(60, 110, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 320; sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x4a6a3a, 0.7));
    scene.add(new THREE.AmbientLight(0x40506a, 0.4));

    // big stylized sun disc
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff4c0 })
    );
    sunDisc.position.set(140, 150, -120);
    scene.add(sunDisc);

    // ---- Terrain ----
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 2, WORLD_SIZE * 2, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const grass = new THREE.Color(0x5a8c3a);
    const grassDark = new THREE.Color(0x3d6b28);
    const rock = new THREE.Color(0x6b6256);
    const sand = new THREE.Color(0xb8a878);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      // color by height + slope-ish
      let c;
      if (y < 0.2) c = sand.clone();
      else if (y > 13) c = rock.clone();
      else c = grass.clone().lerp(grassDark, noise(x * 0.2, z * 0.2));
      // subtle path tint near center cross
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.receiveShadow = true;
    scene.add(terrain);
    this.terrain = terrain;

    // ---- Water plane (low areas) ----
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE * 2, WORLD_SIZE * 2),
      new THREE.MeshStandardMaterial({ color: 0x2f6f9f, transparent: true, opacity: 0.78, roughness: 0.2, metalness: 0.3 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.2;
    scene.add(water);
    this.water = water;

    // ---- Scenery ----
    this._scatterTrees(150);
    this._scatterRocks(60);
    this._scatterFlowers(180);
    this._buildHamlet();
  }

  _ground(obj, x, z, yOffset = 0) {
    obj.position.set(x, terrainHeight(x, z) + yOffset, z);
  }

  _scatterTrees(n) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 1, flatShading: true });
    const leafMats = [0x2f7a32, 0x3d8c3a, 0x4a9c45, 0x6aa030].map(
      c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true })
    );
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 4, 6);
    const coneGeo = new THREE.ConeGeometry(2.6, 4.5, 7);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * (WORLD_SIZE - 40);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = terrainHeight(x, z);
      if (y < 0.3 || y > 14) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 2; trunk.castShadow = true;
      tree.add(trunk);
      const lm = leafMats[(Math.random() * leafMats.length) | 0];
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.Mesh(coneGeo, lm);
        cone.position.y = 4 + k * 1.8;
        cone.scale.setScalar(1 - k * 0.22);
        cone.castShadow = true;
        tree.add(cone);
      }
      const sc = 0.8 + Math.random() * 0.8;
      tree.scale.setScalar(sc);
      tree.position.set(x, y, z);
      tree.rotation.y = Math.random() * Math.PI;
      this.scene.add(tree);
      this.colliders.push({ x, z, r: 1.2 * sc });
    }
  }

  _scatterRocks(n) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6256, roughness: 1, flatShading: true });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 25 + Math.random() * (WORLD_SIZE - 30);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = terrainHeight(x, z);
      if (y < 0.2) continue;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + Math.random() * 1.6, 0), rockMat);
      rock.position.set(x, y + 0.3, z);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.scale.y *= 0.7;
      rock.castShadow = true; rock.receiveShadow = true;
      this.scene.add(rock);
      if (rock.geometry.parameters.radius > 1) this.colliders.push({ x, z, r: 1.4 });
    }
  }

  _scatterFlowers(n) {
    const colors = [0xffe14a, 0xff5a7a, 0xffffff, 0x9a6aff];
    const geo = new THREE.PlaneGeometry(0.5, 0.5);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * (WORLD_SIZE - 10);
      const z = (Math.random() * 2 - 1) * (WORLD_SIZE - 10);
      const y = terrainHeight(x, z);
      if (y < 0.4 || y > 12) continue;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: colors[(Math.random() * colors.length) | 0], side: THREE.DoubleSide, roughness: 1,
      }));
      m.position.set(x, y + 0.25, z);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
    }
  }

  _buildHamlet() {
    // a handful of cozy houses ringing the spawn plaza
    const spots = [
      [14, 8], [-15, 10], [10, -16], [-12, -14], [20, -2], [-22, -4],
    ];
    for (const [x, z] of spots) this._house(x, z);

    // central well/fountain at spawn
    const well = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 1, flatShading: true }));
    base.castShadow = true; base.receiveShadow = true;
    well.add(base);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 12),
      new THREE.MeshStandardMaterial({ color: 0x2f6f9f, transparent: true, opacity: 0.8 }));
    w.position.y = 0.5; well.add(w);
    this._ground(well, 0, 0, 0.4);
    this.scene.add(well);
    this.colliders.push({ x: 0, z: 0, r: 2.4 });
  }

  _house(x, z) {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 1, flatShading: true });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a4326, roughness: 1, flatShading: true });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 1, flatShading: true });

    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), wallMat);
    body.position.y = 2; body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    // beams
    for (const [bx, bz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), woodMat);
      beam.position.set(bx, 2, bz); g.add(beam);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 3, 4), roofMat);
    roof.position.y = 5.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    g.add(roof);
    // door
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.2), woodMat);
    door.position.set(0, 1.2, 3.05); g.add(door);

    g.rotation.y = Math.atan2(-x, -z); // face center
    this._ground(g, x, z, 0);
    this.scene.add(g);
    this.colliders.push({ x, z, r: 4.2 });
  }

  // resolve collision: push position out of prop circles
  resolveCollision(x, z, radius = 0.6) {
    for (const c of this.colliders) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d < min && d > 0.0001) {
        const push = (min - d);
        x += (dx / d) * push;
        z += (dz / d) * push;
      }
    }
    // world bounds
    x = THREE.MathUtils.clamp(x, -WORLD_SIZE + 4, WORLD_SIZE - 4);
    z = THREE.MathUtils.clamp(z, -WORLD_SIZE + 4, WORLD_SIZE - 4);
    return [x, z];
  }

  update(t) {
    if (this.water) this.water.material.opacity = 0.72 + Math.sin(t * 1.5) * 0.06;
  }
}
