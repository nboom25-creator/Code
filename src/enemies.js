// ===========================================================
// Enemies: spawning, simple AI (idle/patrol/chase/attack), death.
// ===========================================================
import * as THREE from "three";
import { groundHeight } from "./world.js";

function mat(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }); }

// ---- Enemy archetype models ----
function buildBoar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.9), mat(0x6a4a30));
  body.position.y = 0.9; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(0x5a3e28));
  head.position.set(1.0, 0.9, 0); head.castShadow = true; g.add(head);
  for (const [sx, sz] of [[-0.6,-0.3],[0.6,-0.3],[-0.6,0.3],[0.6,0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.6,0.22), mat(0x4a3220));
    leg.position.set(sx,0.3,sz); leg.castShadow = true; g.add(leg);
  }
  g.userData.legs = g.children.slice(2);
  return g;
}
function buildWolf() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5,0.7,0.7), mat(0x55585f));
  body.position.y = 0.85; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.55,0.55), mat(0x44474d));
  head.position.set(0.95,1.0,0); head.castShadow = true; g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.18,0.18), mat(0x44474d));
  tail.position.set(-0.95,1.0,0); g.add(tail);
  for (const [sx,sz] of [[-0.5,-0.25],[0.5,-0.25],[-0.5,0.25],[0.5,0.25]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.7,0.18), mat(0x3a3d42));
    leg.position.set(sx,0.35,sz); leg.castShadow = true; g.add(leg);
  }
  g.userData.legs = g.children.slice(3);
  return g;
}
function buildHumanoid(color) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.9,0.4), mat(color));
  torso.position.y = 1.4; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45,0.45,0.45), mat(0x9a7a50));
  head.position.y = 2.05; head.castShadow = true; g.add(head);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.8,0.18), mat(color));
  armL.position.set(-0.5,1.35,0); armL.castShadow = true; g.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.8,0.18), mat(color));
  armR.position.set(0.5,1.35,0); armR.castShadow = true; g.add(armR);
  for (const sx of [-0.2,0.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.9,0.22), mat(0x3a2f20));
    leg.position.set(sx,0.5,0); leg.castShadow = true; g.add(leg);
  }
  g.userData.legs = g.children.slice(4);
  g.userData.arms = [armL, armR];
  return g;
}

function buildSkeleton() {
  const bone = 0xe8e2d0;
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.8,0.34), mat(bone));
  torso.position.y = 1.4; torso.castShadow = true; g.add(torso);
  // rib gaps
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.7,0.2), mat(0x3a3a3a));
  spine.position.set(0,1.4,0.08); g.add(spine);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.42,0.4), mat(bone));
  head.position.y = 2.0; head.castShadow = true; g.add(head);
  const eMat = new THREE.MeshStandardMaterial({ color:0xff3020, emissive:0xff2010, emissiveIntensity:1.3 });
  for (const ex of [-1,1]) { const eye=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,0.05),eMat); eye.position.set(ex*0.1,2.02,0.21); g.add(eye); }
  const armL=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.8,0.12),mat(bone)); armL.position.set(-0.42,1.35,0); armL.castShadow=true; g.add(armL);
  const armR=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.8,0.12),mat(bone)); armR.position.set(0.42,1.35,0); armR.castShadow=true; g.add(armR);
  for (const sx of [-0.16,0.16]) { const leg=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.9,0.14),mat(bone)); leg.position.set(sx,0.5,0); leg.castShadow=true; g.add(leg); }
  g.userData.legs = g.children.slice(-2);
  g.userData.arms = [armL, armR];
  return g;
}
function buildWraith() {
  const g = new THREE.Group();
  const robe = new THREE.MeshStandardMaterial({ color:0x2a1840, roughness:1, flatShading:true, transparent:true, opacity:0.85, emissive:0x3a1060, emissiveIntensity:0.5 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.7,2.2,7), robe); body.position.y=1.4; body.castShadow=true; g.add(body);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), robe); hood.position.y=2.3; g.add(hood);
  const eMat = new THREE.MeshStandardMaterial({ color:0x80f0ff, emissive:0x40d0ff, emissiveIntensity:1.6 });
  for (const ex of [-1,1]) { const eye=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.1,0.05),eMat); eye.position.set(ex*0.12,2.32,0.26); g.add(eye); }
  const glow = new THREE.PointLight(0x6a40ff, 1.5, 8); glow.position.y=2; g.add(glow);
  g.userData.float = true;
  return g;
}
function buildBoss() {
  const g = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color:0x2a1030, roughness:0.6, metalness:0.4, flatShading:true, emissive:0x3a0820, emissiveIntensity:0.4 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.4,1.7,0.8), armor); torso.position.y=2.6; torso.castShadow=true; g.add(torso);
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(1.3,0.6,0.7), armor); pelvis.position.y=1.7; g.add(pelvis);
  for (const sx of [-1,1]) { const pad=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.5,0.9), armor); pad.position.set(sx*1.0,3.4,0); pad.castShadow=true; g.add(pad);
    const spike=new THREE.Mesh(new THREE.ConeGeometry(0.2,0.7,5), mat(0x901040)); spike.position.set(sx*1.0,3.9,0); g.add(spike); }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8), mat(0x6a7a6a)); head.position.y=3.9; head.castShadow=true; g.add(head);
  const eMat = new THREE.MeshStandardMaterial({ color:0xff2020, emissive:0xff1010, emissiveIntensity:1.8 });
  for (const ex of [-1,1]) { const eye=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.12,0.06),eMat); eye.position.set(ex*0.2,3.95,0.41); g.add(eye); }
  const armL=new THREE.Mesh(new THREE.BoxGeometry(0.4,1.5,0.4), armor); armL.position.set(-1.0,2.4,0); armL.castShadow=true; g.add(armL);
  const armR=new THREE.Mesh(new THREE.BoxGeometry(0.4,1.5,0.4), armor); armR.position.set(1.0,2.4,0); armR.castShadow=true; g.add(armR);
  for (const sx of [-0.4,0.4]) { const leg=new THREE.Mesh(new THREE.BoxGeometry(0.5,1.7,0.5), armor); leg.position.set(sx,0.85,0); leg.castShadow=true; g.add(leg); }
  // huge axe
  const axe = new THREE.Group();
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,2.4,6), mat(0x2a1a10)); axe.add(handle);
  const blade=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.8,0.1), mat(0xb02040)); blade.position.y=1.0; axe.add(blade);
  axe.position.set(1.0,1.6,0.3); axe.rotation.z=0.3; g.add(axe);
  const aura = new THREE.PointLight(0x9a20ff, 2.5, 14); aura.position.y=3; g.add(aura);
  g.userData.legs = g.children.filter((c,i)=>false); // boss doesn't leg-walk much
  g.userData.arms = [armL, armR];
  return g;
}

const ENEMY_TYPES = {
  boar:    { name: "Ridgeback Boar", build: buildBoar,    hp: 45,  dmg: 5,  xp: 22, speed: 4.2, aggro: 11, range: 2.2, scale: 1.0, elite:false, hostile:"neutral" },
  wolf:    { name: "Gray Stalker",   build: buildWolf,    hp: 40,  dmg: 6,  xp: 25, speed: 5.5, aggro: 14, range: 2.2, scale: 1.0, elite:false, hostile:"hostile" },
  bandit:  { name: "Defias Brigand", build: () => buildHumanoid(0x7a2a2a), hp: 60, dmg: 8, xp: 35, speed: 4.8, aggro: 13, range: 2.4, scale: 1.0, elite:false, hostile:"hostile" },
  scout:   { name: "Kobold Tunneler",build: () => buildHumanoid(0x6a6030), hp: 30, dmg: 4, xp: 18, speed: 4.0, aggro: 10, range: 2.2, scale: 0.8, elite:false, hostile:"hostile" },
  ogre:    { name: "Hill Ogre",      build: () => buildHumanoid(0x4a6a3a), hp: 220, dmg: 18, xp: 140, speed: 3.8, aggro: 15, range: 3.0, scale: 1.8, elite:true, hostile:"hostile" },
  skeleton:{ name: "Crypt Skeleton", build: buildSkeleton, hp: 70,  dmg: 11, xp: 55,  speed: 4.6, aggro: 13, range: 2.2, scale: 1.0, elite:false, hostile:"hostile" },
  wraith:  { name: "Tormented Wraith",build: buildWraith,  hp: 90,  dmg: 14, xp: 80,  speed: 5.2, aggro: 15, range: 2.4, scale: 1.0, elite:false, hostile:"hostile", flying:true },
  boss:    { name: "Lord Mortis",    build: buildBoss,     hp: 1400,dmg: 38, xp: 1200,speed: 3.6, aggro: 30, range: 4.0, scale: 1.0, elite:true, hostile:"hostile", boss:true },
};

let _id = 0;

export class Enemy {
  constructor(scene, typeKey, x, z, level) {
    this.scene = scene;
    this.id = ++_id;
    this.type = ENEMY_TYPES[typeKey];
    this.typeKey = typeKey;
    this.level = level;
    const lvlMul = 1 + (level - 1) * 0.18;
    this.maxHp = Math.round(this.type.hp * lvlMul);
    this.hp = this.maxHp;
    this.dmg = Math.round(this.type.dmg * lvlMul);
    this.xp = Math.round(this.type.xp * lvlMul);
    this.speed = this.type.speed;
    this.dead = false;

    this.model = this.type.build();
    this.model.scale.setScalar(this.type.scale);
    this.model.position.set(x, groundHeight(x, z), z);
    this.model.userData.enemy = this;
    // make children pickable
    this.model.traverse(o => { if (o.isMesh) o.userData.enemy = this; });
    scene.add(this.model);

    this.home = new THREE.Vector3(x, 0, z);
    this.state = "idle";
    this.target = null;
    this.atkCd = 0;
    this.wanderT = Math.random() * 4;
    this.wanderDir = Math.random() * Math.PI * 2;
    this.hitFlash = 0;
    this.slowT = 0;

    // overhead health bar (sprite)
    this._makeHealthBar();
  }

  _makeHealthBar() {
    const cvs = document.createElement("canvas");
    cvs.width = 128; cvs.height = 32;
    this._barCvs = cvs;
    this._barCtx = cvs.getContext("2d");
    const tex = new THREE.CanvasTexture(cvs);
    this._barTex = tex;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(3.2, 0.8, 1);
    const tops = { ogre: 5.2, boss: 6.6, skeleton: 3.0, wraith: 3.4, bandit: 3.0, scout: 3.0 };
    const top = tops[this.typeKey] ?? 2.4;
    spr.position.y = top * this.type.scale;
    if (this.type.boss) spr.scale.set(5.5, 1.4, 1);
    this.bar = spr;
    this.model.add(spr);
    this._drawBar();
    spr.visible = false; // only show when damaged/targeted
  }

  _drawBar(selected = false) {
    const ctx = this._barCtx;
    ctx.clearRect(0, 0, 128, 32);
    // name
    ctx.font = "bold 13px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillStyle = "#000"; ctx.fillText(`${this.type.name} (${this.level})`, 64, 11);
    const nameColor = this.type.elite ? "#ffd24a" : this.type.hostile === "hostile" ? "#ff7a6a" : "#ffd24a";
    ctx.fillStyle = nameColor; ctx.fillText(`${this.type.name} (${this.level})`, 64, 10);
    // bar bg
    ctx.fillStyle = "#000"; ctx.fillRect(14, 18, 100, 9);
    const pct = Math.max(0, this.hp / this.maxHp);
    ctx.fillStyle = this.type.hostile === "hostile" ? "#cc2020" : "#ccaa20";
    ctx.fillRect(15, 19, 98 * pct, 7);
    if (selected) { ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 2; ctx.strokeRect(13, 17, 102, 11); }
    this._barTex.needsUpdate = true;
  }

  setSelected(sel) { this.bar.visible = sel || this.hp < this.maxHp; this._drawBar(sel); }

  takeDamage(amount) {
    if (this.dead) return;
    this.hp -= amount;
    this.hitFlash = 0.15;
    this.bar.visible = true;
    this._drawBar();
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  applySlow(dur) { this.slowT = Math.max(this.slowT, dur); }

  die() {
    this.dead = true;
    this.state = "dead";
    this.deathT = 0;
  }

  update(dt, player, t) {
    if (this.dead) {
      // sink + fade then will be removed by manager
      this.deathT += dt;
      this.model.rotation.z = Math.min(this.deathT * 3, Math.PI / 2);
      this.model.position.y -= dt * 0.6;
      return;
    }

    // ground (flyers bob above it)
    const px = this.model.position.x, pz = this.model.position.z;
    const baseY = groundHeight(px, pz);
    this.model.position.y = this.type.flying ? baseY + 1.4 + Math.sin(t * 2 + this.id) * 0.3 : baseY;

    if (this.atkCd > 0) this.atkCd -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    const toPlayer = new THREE.Vector3().subVectors(player.position, this.model.position);
    const distP = toPlayer.length();

    // aggro logic
    if (!player.dead && this.type.hostile === "hostile" && this.state !== "chase" && distP < this.type.aggro) {
      this.state = "chase"; this.target = player;
    }
    if (this.state === "chase" && (player.dead || distP > this.type.aggro * 2.2)) {
      this.state = "return"; this.target = null;
    }

    const speed = this.speed * (this.slowT > 0 ? 0.5 : 1);
    let moving = false;

    if (this.state === "chase") {
      this.model.lookAt(player.position.x, this.model.position.y, player.position.z);
      if (distP > this.type.range) {
        const step = Math.min(speed * dt, distP - this.type.range + 0.01);
        this.model.position.x += (toPlayer.x / distP) * step;
        this.model.position.z += (toPlayer.z / distP) * step;
        moving = true;
      } else {
        // attack
        if (this.atkCd <= 0) {
          this.atkCd = 1.8;
          player.takeDamage(this.dmg, this);
          this._swing = 0.3;
        }
      }
    } else if (this.state === "return") {
      const toHome = new THREE.Vector3(this.home.x - px, 0, this.home.z - pz);
      const d = toHome.length();
      if (d < 1) { this.state = "idle"; this.hp = this.maxHp; this.bar.visible = false; this._drawBar(); }
      else {
        this.model.lookAt(this.home.x, this.model.position.y, this.home.z);
        this.model.position.x += (toHome.x / d) * speed * dt;
        this.model.position.z += (toHome.z / d) * speed * dt;
        moving = true;
      }
    } else {
      // idle wander near home
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = 2 + Math.random() * 4; this.wanderDir = Math.random() * Math.PI * 2; this._wandering = Math.random() > 0.4; }
      if (this._wandering) {
        const nx = px + Math.cos(this.wanderDir) * speed * 0.4 * dt;
        const nz = pz + Math.sin(this.wanderDir) * speed * 0.4 * dt;
        if (Math.hypot(nx - this.home.x, nz - this.home.z) < 10) {
          this.model.position.x = nx; this.model.position.z = nz;
          this.model.lookAt(nx + Math.cos(this.wanderDir), this.model.position.y, nz + Math.sin(this.wanderDir));
          moving = true;
        }
      }
    }

    // leg animation
    const legs = this.model.userData.legs;
    if (legs) {
      if (moving) {
        const sw = Math.sin(t * 10) * 0.5;
        legs.forEach((l, i) => l.rotation.x = (i % 2 ? sw : -sw));
      } else legs.forEach(l => l.rotation.x = THREE.MathUtils.lerp(l.rotation.x, 0, 0.1));
    }
    // arm swing on attack
    if (this.model.userData.arms && this._swing > 0) {
      this._swing -= dt;
      this.model.userData.arms[1].rotation.x = -2 * Math.max(0, this._swing / 0.3);
    }

    // hit flash
    this.model.traverse(o => {
      if (o.isMesh && o.material.emissive) {
        o.material.emissive.setHex(this.hitFlash > 0 ? 0x661111 : 0x000000);
      }
    });
  }

  dispose() {
    this.scene.remove(this.model);
    this.model.traverse(o => {
      if (o.isMesh) { o.geometry.dispose?.(); }
    });
    this._barTex.dispose();
  }
}

export class EnemyManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enemies = [];
    this.spawnPoints = [];
  }

  // Populate from a zone config. `onBoss` is called with the boss enemy if any.
  populate(zone, onBoss) {
    this.zone = zone;
    const dungeon = zone.type === "dungeon";
    for (const p of (zone.packs || [])) {
      for (let i = 0; i < p.count; i++) {
        let x, z;
        if (p.dungeon) {
          x = (Math.random() * 2 - 1) * ((zone.width || 26) / 2 - 3);
          z = p.zStart + Math.random() * (p.zEnd - p.zStart);
        } else {
          const a = Math.random() * Math.PI * 2;
          const r = p.rMin + Math.random() * (p.rMax - p.rMin);
          x = Math.cos(a) * r; z = Math.sin(a) * r;
        }
        const lvl = p.lvl[0] + ((Math.random() * (p.lvl[1] - p.lvl[0] + 1)) | 0);
        const e = new Enemy(this.scene, p.key, x, z, lvl);
        e.respawns = !dungeon;
        this.enemies.push(e);
      }
    }
    if (zone.boss) {
      const spot = zone.bossSpot || { x: 0, z: -(zone.length || 130) + 22 };
      const b = new Enemy(this.scene, zone.boss.key, spot.x, spot.z, zone.boss.lvl);
      b.respawns = false;
      b.isBoss = true;
      this.enemies.push(b);
      onBoss?.(b);
    }
  }

  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
  }

  update(dt, player, t) {
    for (const e of this.enemies) e.update(dt, player, t);
    // remove fully dead, schedule respawn
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.deathT > 3) {
        const respawns = e.respawns !== false;
        const key = e.typeKey, lvl = e.level, hx = e.home.x, hz = e.home.z;
        e.dispose();
        this.enemies.splice(i, 1);
        if (respawns) {
          setTimeout(() => {
            const ne = new Enemy(this.scene, key, hx, hz, lvl);
            this.enemies.push(ne);
          }, 12000);
        }
      }
    }
  }

  // pick nearest hostile within angle of camera for Tab targeting
  nextTarget(player, camera) {
    const alive = this.enemies.filter(e => !e.dead);
    if (!alive.length) return null;
    alive.sort((a, b) =>
      a.model.position.distanceTo(player.position) - b.model.position.distanceTo(player.position));
    return alive[0];
  }
}
