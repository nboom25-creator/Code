// ===========================================================
// HUD: unit frames, action bar, minimap, cast bar, combat log,
// floating combat text, quest tracker.
// ===========================================================
import * as THREE from "three";
import { ABILITIES, CLASS_KIT } from "./data.js";
import { WORLD_SIZE } from "./world.js";

const $ = id => document.getElementById(id);

export class UI {
  constructor() {
    this.combatLogEl = $("combat-log");
    this.dmgLayer = $("dmg-layer");
    this.miniCtx = $("minimap-canvas").getContext("2d");
    this._logCount = 0;
  }

  bind(player, camera) {
    this.player = player;
    this.camera = camera;
    $("player-name").textContent = player.name;
    $("player-portrait").textContent = player.race.emblem;
    this._buildActionBar();
    this._buildQuest();
  }

  // ---------- action bar ----------
  _buildActionBar() {
    const bar = $("action-bar");
    bar.innerHTML = "";
    this.kit = CLASS_KIT[this.player.cls.id];
    this.kit.forEach((abId, i) => {
      const ab = ABILITIES[abId];
      const slot = document.createElement("div");
      slot.className = "action-slot";
      slot.dataset.ability = abId;
      slot.dataset.index = i;
      slot.innerHTML = `
        <span class="key">${i + 1}</span>
        <span class="icon">${ab.icon}</span>
        <div class="cd hidden"></div>
        <div class="name-tt"><b>${ab.name}</b><br>${ab.desc}<br>
          <span style="color:#9fb">Cost: ${ab.cost || 0} ${this.player.resourceType}</span></div>`;
      bar.appendChild(slot);
    });
  }

  refreshActionBar() {
    const slots = $("action-bar").children;
    for (let i = 0; i < slots.length; i++) {
      const abId = this.kit[i];
      const ab = ABILITIES[abId];
      const cd = this.player.cooldowns[abId] || 0;
      const gcd = this.player.gcd || 0;
      const eff = Math.max(cd, ab.cd ? gcd : 0);
      const cdEl = slots[i].querySelector(".cd");
      if (eff > 0.05) { cdEl.classList.remove("hidden"); cdEl.textContent = eff.toFixed(eff < 1 ? 1 : 0); }
      else cdEl.classList.add("hidden");
      // mana shading
      slots[i].classList.toggle("no-mana", this.player.resource < (ab.cost || 0));
    }
  }

  // ---------- frames ----------
  updatePlayerFrame() {
    const p = this.player;
    $("player-level-badge").textContent = p.level;
    const hpPct = (p.hp / p.maxHp) * 100;
    $("player-health").style.width = hpPct + "%";
    $("player-health-text").textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    const mpPct = (p.resource / p.maxResource) * 100;
    $("player-mana").style.width = mpPct + "%";
    const fill = $("player-mana");
    // tint mana bar by resource type
    const colors = { mana: "linear-gradient(#4a8fff,#102a55)", rage: "linear-gradient(#e04040,#5a1010)", energy: "linear-gradient(#e0d040,#5a5010)" };
    fill.style.background = colors[p.resourceType];
    $("player-mana-text").textContent = `${Math.ceil(p.resource)} / ${p.maxResource}`;
    // xp
    $("xp-fill").style.width = (p.xp / p.xpNeeded) * 100 + "%";
    $("xp-text").textContent = `XP ${p.xp} / ${p.xpNeeded}`;
  }

  updateTargetFrame(target) {
    const tf = $("target-frame");
    if (!target || target.dead) { tf.classList.add("hidden"); return; }
    tf.classList.remove("hidden");
    $("target-name").textContent = target.type.name;
    $("target-level-badge").textContent = target.level;
    $("target-portrait").textContent = target.type.elite ? "💀" : "👹";
    $("target-health").style.width = (target.hp / target.maxHp) * 100 + "%";
    $("target-health-text").textContent = `${Math.ceil(target.hp)} / ${target.maxHp}`;
  }

  // ---------- cast bar ----------
  updateCastBar() {
    const c = this.player.casting;
    const cb = $("cast-bar");
    if (!c) { cb.classList.add("hidden"); return; }
    cb.classList.remove("hidden");
    $("cast-fill").style.width = (c.elapsed / c.total) * 100 + "%";
    $("cast-text").textContent = c.ability.name;
  }

  // ---------- combat log ----------
  log(text, cls = "log-info") {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    this.combatLogEl.prepend(d);
    while (this.combatLogEl.children.length > 12) this.combatLogEl.lastChild.remove();
  }

  // ---------- floating combat text ----------
  floatText(amount, kind, worldPos) {
    const v = worldPos.clone();
    v.y += 2.2;
    v.project(this.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement("div");
    const crit = typeof amount === "object" && amount.crit;
    const val = typeof amount === "object" ? amount.value : amount;
    el.className = `float-dmg ${kind}` + (crit ? " crit" : "");
    el.textContent = (kind === "heal" ? "+" : kind === "taken" ? "-" : "") + Math.round(val) + (crit ? "!" : "");
    el.style.left = x + "px";
    el.style.top = y + "px";
    this.dmgLayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  levelUpFx() {
    const el = document.createElement("div");
    el.className = "float-dmg deal crit";
    el.textContent = "LEVEL UP!";
    el.style.left = "50%"; el.style.top = "45%";
    el.style.color = "#ffd24a"; el.style.fontSize = "48px";
    this.dmgLayer.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  // ---------- minimap ----------
  updateMinimap(player, enemies) {
    const ctx = this.miniCtx;
    const R = 80, scale = 80 / 90; // show ~90 units radius
    ctx.clearRect(0, 0, 160, 160);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#2f4a24"; ctx.fillRect(0, 0, 160, 160);
    // grid feel
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    for (let i = 0; i < 160; i += 16) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,160); ctx.moveTo(0,i); ctx.lineTo(160,i); ctx.stroke(); }
    // center plaza marker
    const px = player.position.x, pz = player.position.z;
    ctx.fillStyle = "#caa84a";
    const cx = R + (0 - px) * scale, cz = R + (0 - pz) * scale;
    ctx.fillRect(cx - 3, cz - 3, 6, 6);
    // enemies
    for (const e of enemies) {
      if (e.dead) continue;
      const ex = R + (e.model.position.x - px) * scale;
      const ez = R + (e.model.position.z - pz) * scale;
      if (Math.hypot(ex - R, ez - R) > R) continue;
      ctx.fillStyle = e.type.hostile === "hostile" ? "#ff4040" : "#ffcc40";
      ctx.beginPath(); ctx.arc(ex, ez, e.type.elite ? 3.5 : 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // player arrow (always center, points up = facing)
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(player.yaw + Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------- quests ----------
  _buildQuest() {
    this.quest = { title: "Cull the Wilds", need: 8, have: 0, done: false,
                   bonusNeed: 3, bonusHave: 0 };
    this.renderQuest();
  }

  questProgress(isElite) {
    if (this.quest.have < this.quest.need) this.quest.have++;
    if (isElite && this.quest.bonusHave < this.quest.bonusNeed) this.quest.bonusHave++;
    if (this.quest.have >= this.quest.need && !this.quest.done) {
      this.quest.done = true;
      this.log("Quest complete: Cull the Wilds! Slay a Hill Ogre for the bonus.", "log-crit");
    }
    this.renderQuest();
  }

  renderQuest() {
    const q = this.quest;
    $("quest-tracker").innerHTML = `
      <h4>${q.title}</h4>
      <div class="obj ${q.have >= q.need ? "done" : ""}">Creatures slain: ${q.have}/${q.need}</div>
      <div class="obj ${q.bonusHave >= q.bonusNeed ? "done" : ""}">Bonus — Ogres slain: ${q.bonusHave}/${q.bonusNeed}</div>`;
  }
}
