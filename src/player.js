// ===========================================================
// Player: stats, leveling, movement, jump, resource regen.
// Combat resolution (abilities/projectiles) lives in main.js
// since it needs the enemy list & UI.
// ===========================================================
import * as THREE from "three";
import { buildCharacter, animateCharacter } from "./characterModel.js";
import { CLASSES } from "./data.js";
import { terrainHeight } from "./world.js";

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

    this._recalcStats();
    this.hp = this.maxHp;
    this.resource = this.cls.resource === "rage" ? 0 : this.maxResource; // rage starts empty
    this.dead = false;

    // model
    this.model = buildCharacter(race, this.cls.color);
    this.position = new THREE.Vector3(6, 0, 6);
    this.position.y = terrainHeight(6, 6);
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
    this.maxHp = Math.round((c.baseHp + c.hpPerLvl * (this.level - 1)) * racialHp);
    if (c.resource === "mana") {
      const racialMp = this.race.id === "gnome" ? 1.15 : 1.0;
      this.maxResource = Math.round((c.baseMp + c.mpPerLvl * (this.level - 1)) * racialMp);
    } else if (c.resource === "energy") {
      this.maxResource = 100;
    } else { // rage
      this.maxResource = 100;
    }
    this.attackPower = 4 + this.level * 2;
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

  respawn() {
    this.dead = false;
    this.hp = this.maxHp;
    this.resource = this.resourceType === "rage" ? 0 : this.maxResource;
    this.position.set(6, terrainHeight(6, 6), 6);
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

    // ---- movement (camera-relative) ----
    const fwd = new THREE.Vector3(-Math.sin(input.cameraYaw), 0, -Math.cos(input.cameraYaw));
    const right = new THREE.Vector3(Math.cos(input.cameraYaw), 0, -Math.sin(input.cameraYaw));
    const move = new THREE.Vector3();
    if (input.keys.w) move.add(fwd);
    if (input.keys.s) move.sub(fwd);
    if (input.keys.a) move.sub(right);
    if (input.keys.d) move.add(right);

    // casting interrupts on move
    if (this.casting && move.lengthSq() > 0) { this.casting = null; }

    this.moving = move.lengthSq() > 0 && !this.casting;
    let speed = this.moveSpeed;
    this.sprinting = input.keys.shift && this.moving;
    if (this.sprinting) speed *= 1.4;

    if (this.moving) {
      move.normalize();
      this.yaw = Math.atan2(move.x, move.z);
      let nx = this.position.x + move.x * speed * dt;
      let nz = this.position.z + move.z * speed * dt;
      [nx, nz] = world.resolveCollision(nx, nz, 0.6);
      this.position.x = nx; this.position.z = nz;
    }

    // jump + gravity
    const groundY = terrainHeight(this.position.x, this.position.z);
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
