// ===========================================================
// Enemies: creature instances (built from creature defs), simple
// AI (idle/chase/attack/leash), death, and chunk-based streaming
// spawn/despawn for the open world (+ instanced dungeon spawning).
// ===========================================================
import * as THREE from "three";
import { groundHeight } from "./world.js";
import { buildCreature, animateBody, getCreature } from "./creatures.js";
import { CELL, cellCenter, SEA_LEVEL } from "./regions.js";

let _id = 0;

export class Enemy {
  constructor(scene, def, x, z, level) {
    this.scene = scene;
    this.id = ++_id;
    this.type = def;
    this.level = level;
    const m = 1 + (level - 1) * 0.16;
    this.maxHp = Math.round(def.hp * m);
    this.hp = this.maxHp;
    this.dmg = Math.round(def.dmg * m);
    this.xp = Math.round(def.xp * m);
    this.speed = def.speed;
    this.dead = false;
    this.isBoss = !!def.boss;

    this.model = buildCreature(def);
    this.model.position.set(x, groundHeight(x, z), z);
    this.model.traverse(o => {
      o.userData.enemy = this;
      if (o.isMesh && o.material && o.material.emissive) o.material.userData.baseEmissive = o.material.emissive.getHex();
    });
    scene.add(this.model);

    this.home = new THREE.Vector3(x, 0, z);
    this.state = "idle";
    this.target = null;
    this.atkCd = 0;
    this.wanderT = Math.random() * 4;
    this.wanderDir = Math.random() * Math.PI * 2;
    this.hitFlash = 0;
    this.slowT = 0;
    this._swing = 0;
    this.respawns = false;

    this._makeHealthBar();
  }

  _makeHealthBar() {
    const cvs = document.createElement("canvas");
    cvs.width = 128; cvs.height = 32;
    this._barCtx = cvs.getContext("2d");
    this._barTex = new THREE.CanvasTexture(cvs);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._barTex, depthTest: false, transparent: true }));
    const s = this.model.scale.x || 1;
    const box = new THREE.Box3().setFromObject(this.model);
    spr.position.y = (box.max.y + 0.6) / s;
    const bw = this.type.boss ? 5.5 : 3.2, bh = this.type.boss ? 1.4 : 0.8;
    spr.scale.set(bw / s, bh / s, 1);
    this.bar = spr;
    this.model.add(spr);
    this._drawBar();
    spr.visible = false;
  }

  _drawBar(selected = false) {
    const ctx = this._barCtx;
    ctx.clearRect(0, 0, 128, 32);
    ctx.font = "bold 13px Trebuchet MS"; ctx.textAlign = "center";
    const label = `${this.type.name} (${this.level})`;
    ctx.fillStyle = "#000"; ctx.fillText(label, 64, 11);
    ctx.fillStyle = this.type.elite || this.type.boss ? "#ffd24a" : this.type.hostile === "hostile" ? "#ff7a6a" : "#ffd24a";
    ctx.fillText(label, 64, 10);
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
    // become aggressive when hit
    if (this.state === "idle" || this.state === "return") this._aggravated = true;
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  applySlow(dur) { this.slowT = Math.max(this.slowT, dur); }

  die() { this.dead = true; this.state = "dead"; this.deathT = 0; }

  update(dt, player, t) {
    if (this.dead) {
      this.deathT += dt;
      this.model.rotation.z = Math.min(this.deathT * 3, Math.PI / 2);
      this.model.position.y -= dt * 0.6;
      return;
    }

    const px = this.model.position.x, pz = this.model.position.z;
    const baseY = groundHeight(px, pz);
    this.model.position.y = this.type.flying ? baseY + 1.2 + Math.sin(t * 2 + this.id) * 0.3 : baseY;

    if (this.atkCd > 0) this.atkCd -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this._swing > 0) this._swing -= dt;

    const toP = new THREE.Vector3().subVectors(player.position, this.model.position);
    const distP = toP.length();

    const hostile = this.type.hostile === "hostile" || this._aggravated;
    if (!player.dead && hostile && this.state !== "chase" && distP < this.type.aggro) {
      this.state = "chase"; this.target = player;
    }
    if (this.state === "chase" && (player.dead || distP > this.type.aggro * 2.4)) {
      this.state = "return"; this.target = null; this._aggravated = false;
    }

    const speed = this.speed * (this.slowT > 0 ? 0.5 : 1);
    let moving = false;

    if (this.state === "chase") {
      this.model.lookAt(player.position.x, this.model.position.y, player.position.z);
      if (distP > this.type.range) {
        const step = Math.min(speed * dt, distP - this.type.range + 0.01);
        this.model.position.x += (toP.x / distP) * step;
        this.model.position.z += (toP.z / distP) * step;
        moving = true;
      } else if (this.atkCd <= 0) {
        this.atkCd = 1.8;
        player.takeDamage(this.dmg, this);
        this._swing = 0.3;
      }
    } else if (this.state === "return") {
      const dx = this.home.x - px, dz = this.home.z - pz, d = Math.hypot(dx, dz);
      if (d < 1) { this.state = "idle"; this.hp = this.maxHp; this.bar.visible = false; this._drawBar(); }
      else {
        this.model.lookAt(this.home.x, this.model.position.y, this.home.z);
        this.model.position.x += (dx / d) * speed * dt;
        this.model.position.z += (dz / d) * speed * dt;
        moving = true;
      }
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = 2 + Math.random() * 4; this.wanderDir = Math.random() * Math.PI * 2; this._wandering = Math.random() > 0.4; }
      if (this._wandering) {
        const nx = px + Math.cos(this.wanderDir) * speed * 0.4 * dt;
        const nz = pz + Math.sin(this.wanderDir) * speed * 0.4 * dt;
        if (Math.hypot(nx - this.home.x, nz - this.home.z) < 12) {
          this.model.position.x = nx; this.model.position.z = nz;
          this.model.lookAt(nx + Math.cos(this.wanderDir), this.model.position.y, nz + Math.sin(this.wanderDir));
          moving = true;
        }
      }
    }

    animateBody(this.model, { moving, t: t + this.id, swing: Math.max(0, this._swing / 0.3) });

    this.model.traverse(o => {
      if (o.isMesh && o.material && o.material.emissive && !o.userData.keepEmissive) {
        o.material.emissive.setHex(this.hitFlash > 0 ? 0x661111 : (o.material.userData?.baseEmissive ?? 0x000000));
      }
    });
  }

  dispose() {
    this.scene.remove(this.model);
    this.model.traverse(o => { if (o.isMesh) o.geometry?.dispose?.(); });
    this._barTex.dispose();
  }
}

export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];
    this.chunkCounts = new Map();
  }

  // ---- open-world streaming ----
  spawnChunk(key, region, cx, cz) {
    const [ccx, ccz] = cellCenter(cx, cz);
    const half = CELL / 2 - 16;
    for (const cid of (region.creatures || [])) {
      const def = getCreature(cid);
      if (!def) continue;
      const count = def.elite ? 2 : 5;
      for (let i = 0; i < count; i++) {
        let x, z, y, tries = 0;
        do { x = ccx + (Math.random()*2-1)*half; z = ccz + (Math.random()*2-1)*half; y = groundHeight(x, z); }
        while (y < SEA_LEVEL + 0.6 && ++tries < 6);
        if (y < SEA_LEVEL + 0.6) continue;
        const lvl = region.lvl[0] + ((Math.random() * (region.lvl[1] - region.lvl[0] + 1)) | 0);
        const e = new Enemy(this.scene, def, x, z, lvl);
        e.chunkKey = key;
        this.enemies.push(e);
      }
    }
  }

  despawnChunk(key) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.chunkKey === key && (!e.state || e.state !== "chase")) {
        e.dispose(); this.enemies.splice(i, 1);
      }
    }
  }

  // ---- instanced dungeon ----
  populateDungeon(zoneCfg, bossSpot, onBoss) {
    for (const p of (zoneCfg.packs || [])) {
      const def = getCreature(p.key);
      if (!def) continue;
      for (let i = 0; i < p.count; i++) {
        const x = (Math.random() * 2 - 1) * ((zoneCfg.width || 26) / 2 - 3);
        const z = p.zStart + Math.random() * (p.zEnd - p.zStart);
        const lvl = p.lvl[0] + ((Math.random() * (p.lvl[1] - p.lvl[0] + 1)) | 0);
        const e = new Enemy(this.scene, def, x, z, lvl);
        this.enemies.push(e);
      }
    }
    if (zoneCfg.boss) {
      const def = getCreature(zoneCfg.boss.key);
      const spot = bossSpot || { x: 0, z: -(zoneCfg.length || 130) + 22 };
      const b = new Enemy(this.scene, def, spot.x, spot.z, zoneCfg.boss.lvl);
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
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.deathT > 3) { e.dispose(); this.enemies.splice(i, 1); }
    }
  }
}
