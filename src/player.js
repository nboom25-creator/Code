// ===========================================================
// Player: stats, leveling, movement, jump, resource regen.
// Combat resolution (abilities/projectiles) lives in main.js
// since it needs the enemy list & UI.
// ===========================================================
import * as THREE from "three";
import { buildCharacter, animateCharacter } from "./characterModel.js";
import { CLASSES } from "./data.js";
import { groundHeight } from "./world.js";
import { SLOTS } from "./items.js";

const GRAVITY = -26;
const JUMP_V = 9;

export class Player {
  constructor(scene, race, classId, name) {
    this.scene = scene;
    this.race = race;
    this.cls = CLASSES[classId];
    this.name = name || "Hero";

    this.level = 1;
    this.xp = 0;
    this.xpNeeded = this._xpForLevel(1);

    // inventory & gear
    this.equipped = {};
    for (const s of SLOTS) this.equipped[s] = null;
    this.bags = [];
    this.bagSize = 24;
    this.gear = { stamina: 0, intellect: 0, attackPower: 0, spellPower: 0, crit: 0, armor: 0 };

    this._recalcStats();
    this.hp = this.maxHp;
    this.resource = this.cls.resource === "rage" ? 0 : this.maxResource; // rage starts empty
    this.dead = false;

    // model
    this.model = buildCharacter(race, this.cls.color);
    this.position = new THREE.Vector3(6, 0, 6);
    this.position.y = groundHeight(6, 6);
    this.model.position.copy(this.position);
    scene.add(this.model);

    this.yaw = 0;            // facing
    this.vy = 0;             // vertical velocity
    this.grounded = true;
    this.moving = false;
    this.moveSpeed = 8.5;
    this.t = 0;
    this.attackAnim = 0;     // 0..1 swing timer
    this.gcd = 0;            // global cooldown
    this.cooldowns = {};     // abilityId -> seconds left
    this.casting = null;     // {ability, total, elapsed, target}
    this.sprinting = false;
  }

  _xpForLevel(lvl) { return Math.round(80 * Math.pow(lvl, 1.45)); }

  _recalcStats() {
    const c = this.cls;
    const racialHp = this.race.id === "tauren" ? 1.25 : this.race.id === "human" ? 1.05 : 1.0;
    this._baseMaxHp = Math.round((c.baseHp + c.hpPerLvl * (this.level - 1)) * racialHp);
    if (c.resource === "mana") {
      const racialMp = this.race.id === "gnome" ? 1.15 : 1.0;
      this._baseMaxResource = Math.round((c.baseMp + c.mpPerLvl * (this.level - 1)) * racialMp);
    } else {
      this._baseMaxResource = 100; // rage / energy
    }
    this._baseAttackPower = 4 + this.level * 2;
    this._applyGear();
  }

  // Sum equipped item stats into this.gear, then derive final stats.
  recomputeGear() {
    const g = { stamina: 0, intellect: 0, attackPower: 0, spellPower: 0, crit: 0, armor: 0 };
    for (const s of SLOTS) {
      const it = this.equipped[s];
      if (!it) continue;
      for (const k in it.stats) g[k] = (g[k] || 0) + it.stats[k];
    }
    this.gear = g;
    this._applyGear();
  }

  _applyGear() {
    const g = this.gear;
    const hpPctBefore = this.maxHp ? this.hp / this.maxHp : 1;
    this.maxHp = this._baseMaxHp + g.stamina * 8;
    this.maxResource = this._baseMaxResource + (this.resourceType === "mana" ? g.intellect * 7 : 0);
    this.attackPower = this._baseAttackPower + g.attackPower;
    this.spellPower = g.spellPower + Math.floor(g.intellect * 0.5);
    // keep current hp ratio when max changes from gear swaps
    if (this.hp !== undefined) this.hp = Math.min(this.maxHp, Math.round(hpPctBefore * this.maxHp));
  }

  getAttackPower() { return this.attackPower; }
  getSpellPower() { return this.spellPower || 0; }
  getCritChance() { return 0.12 + this.gear.crit * 0.0025 + (this.race.id === "wildkin" ? 0.05 : 0); }
  getArmorDR() { return Math.min(0.65, this.gear.armor / (this.gear.armor + 350 + this.level * 25)); }
  itemLevel() {
    const items = SLOTS.map(s => this.equipped[s]).filter(Boolean);
    if (!items.length) return 0;
    return Math.round(items.reduce((a, b) => a + b.ilvl, 0) / items.length);
  }

  // ---- inventory ----
  addItem(item) {
    if (this.bags.length >= this.bagSize) return false;
    this.bags.push(item);
    return true;
  }
  equip(item) {
    const idx = this.bags.indexOf(item);
    if (idx >= 0) this.bags.splice(idx, 1);
    const prev = this.equipped[item.slot];
    this.equipped[item.slot] = item;
    if (prev) this.bags.push(prev);
    this.recomputeGear();
    return prev;
  }
  unequip(slot) {
    const it = this.equipped[slot];
    if (!it) return;
    if (this.bags.length >= this.bagSize) return; // no room
    this.equipped[slot] = null;
    this.bags.push(it);
    this.recomputeGear();
  }

  get resourceType() { return this.cls.resource; }

  // ---------- progression ----------
  gainXP(amount, ui) {
    if (this.dead) return;
    this.xp += amount;
    ui.log(`+${amount} experience`, "log-xp");
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this._levelUp(ui);
    }
  }

  _levelUp(ui) {
    this.level++;
    this.xpNeeded = this._xpForLevel(this.level);
    const oldHp = this.maxHp;
    this._recalcStats();
    this.hp = this.maxHp;
    if (this.resourceType !== "rage") this.resource = this.maxResource;
    ui.log(`✦ You reached level ${this.level}! ✦`, "log-crit");
    ui.levelUpFx();
  }

  // ---------- combat in ----------
  takeDamage(amount, source, ui) {
    if (this.dead) return;
    amount = Math.max(1, Math.round(amount * (1 - this.getArmorDR())));
    // rage generation on taking damage
    if (this.resourceType === "rage") this.addResource(amount * 0.5);
    this.hp -= amount;
    this._uiFlash = 0.2;
    if (ui) {
      ui.floatText(amount, "taken", this.model.position);
      ui.log(`${source?.type?.name || "Enemy"} hits you for ${amount}.`, "log-dmg");
    }
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  }

  heal(amount, ui) {
    if (this.dead) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const real = Math.round(this.hp - before);
    if (ui && real > 0) ui.floatText(real, "heal", this.model.position);
  }

  addResource(n) { this.resource = THREE.MathUtils.clamp(this.resource + n, 0, this.maxResource); }
  spendResource(n) {
    if (this.resource < n) return false;
    this.resource -= n; return true;
  }

  respawn(pos) {
    this.dead = false;
    this.hp = this.maxHp;
    this.resource = this.resourceType === "rage" ? 0 : this.maxResource;
    if (pos) this.position.set(pos.x, groundHeight(pos.x, pos.z) + 1, pos.z);
    this.model.position.copy(this.position);
    this.vy = 0;
  }

  // ---------- per-frame ----------
  update(dt, input, world, camera) {
    this.t += dt;

    // cooldowns
    if (this.gcd > 0) this.gcd -= dt;
    for (const k in this.cooldowns) { this.cooldowns[k] -= dt; if (this.cooldowns[k] <= 0) delete this.cooldowns[k]; }

    // resource regen
    if (!this.dead) {
      if (this.resourceType === "mana") this.addResource(this.maxResource * 0.04 * dt + 1.2 * dt);
      else if (this.resourceType === "energy") this.addResource(20 * dt);
      else if (this.resourceType === "rage") this.addResource(-3 * dt); // rage decays
    }

    if (this.dead) { this.moving = false; return; }

    // ---- movement (camera-relative, analog) ----
    const fwd = new THREE.Vector3(-Math.sin(input.cameraYaw), 0, -Math.cos(input.cameraYaw));
    const right = new THREE.Vector3(Math.cos(input.cameraYaw), 0, -Math.sin(input.cameraYaw));
    let f = 0, r = 0;
    if (input.keys.w) f += 1;
    if (input.keys.s) f -= 1;
    if (input.keys.d) r += 1;
    if (input.keys.a) r -= 1;
    if (input.axis) { f += input.axis.f; r += input.axis.r; }
    const move = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, r);
    let mag = move.length();
    if (mag > 1) { move.multiplyScalar(1 / mag); mag = 1; }

    // casting interrupts on move
    if (this.casting && mag > 0.08) { this.casting = null; }

    this.moving = mag > 0.08 && !this.casting;
    let speed = this.moveSpeed;
    this.sprinting = input.keys.shift && this.moving;
    if (this.sprinting) speed *= 1.4;

    if (this.moving) {
      this.yaw = Math.atan2(move.x, move.z);
      let nx = this.position.x + move.x * speed * dt;
      let nz = this.position.z + move.z * speed * dt;
      [nx, nz] = world.resolveCollision(nx, nz, 0.6);
      this.position.x = nx; this.position.z = nz;
    }

    // jump + gravity
    const groundY = groundHeight(this.position.x, this.position.z);
    if (input.jump && this.grounded) { this.vy = JUMP_V; this.grounded = false; }
    input.jump = false;
    this.vy += GRAVITY * dt;
    this.position.y += this.vy * dt;
    if (this.position.y <= groundY) { this.position.y = groundY; this.vy = 0; this.grounded = true; }

    // apply to model
    this.model.position.copy(this.position);
    this.model.rotation.y = this.yaw;

    // attack swing decay
    if (this.attackAnim > 0) { this.attackAnim -= dt * 2.5; if (this.attackAnim < 0) this.attackAnim = 0; }

    animateCharacter(this.model, {
      moving: this.moving, speed: this.sprinting ? 1.4 : 1, t: this.t,
      attackT: this.attackAnim,
    });
  }

  triggerSwing() { this.attackAnim = 1; }
}
