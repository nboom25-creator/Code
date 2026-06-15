/* ============================================================
   main.js — game state, model, UI glue, main loop, save/load.
   ============================================================ */

const SAVE_KEY = "pkmnred_save_v1";

const Game = {
  mode: "title",          // title | starter | overworld | dialogue | startmenu | partyview | bagview | battle
  party: [],
  bag: {},                // id -> qty
  flags: { hasStarter: false },
  scale: 2,

  canvas: null, ctx: null, overlay: null,

  // dialogue state
  dlgPages: [], dlgIndex: 0, dlgDone: null,
  // starter select
  starterIndex: 1,
  // menus
  menuIndex: 0, subIndex: 0,

  /* ---------- model ---------- */
  expForLevel(l) { return l * l * l; },

  statValue(base, level, isHP) {
    if (isHP) return Math.floor((base * 2 * level) / 100) + level + 10;
    return Math.floor((base * 2 * level) / 100) + 5;
  },

  movesAtLevel(species, level) {
    const learn = DEX[species].learn || {};
    let list = [];
    Object.keys(learn).map(Number).sort((a, b) => a - b).forEach(lv => {
      if (lv <= level) learn[lv].forEach(m => list.push(m));
    });
    // dedupe keep last occurrences, cap 4
    const seen = new Set(); const out = [];
    for (let i = list.length - 1; i >= 0 && out.length < 4; i--) {
      if (!seen.has(list[i])) { seen.add(list[i]); out.unshift(list[i]); }
    }
    return out.map(id => ({ id, pp: MOVES[id].pp, maxpp: MOVES[id].pp }));
  },

  createPokemon(species, level) {
    const d = DEX[species];
    const maxhp = this.statValue(d.stats.hp, level, true);
    return {
      species, level, exp: this.expForLevel(level),
      maxhp, hp: maxhp,
      stats: {
        atk: this.statValue(d.stats.atk, level),
        def: this.statValue(d.stats.def, level),
        spd: this.statValue(d.stats.spd, level),
        spc: this.statValue(d.stats.spc, level),
      },
      statMods: { atk: 0, def: 0, spd: 0 },
      moves: this.movesAtLevel(species, level),
    };
  },

  recomputeStats(mon, keepRatio) {
    const d = DEX[mon.species];
    const oldMax = mon.maxhp;
    mon.maxhp = this.statValue(d.stats.hp, mon.level, true);
    mon.stats.atk = this.statValue(d.stats.atk, mon.level);
    mon.stats.def = this.statValue(d.stats.def, mon.level);
    mon.stats.spd = this.statValue(d.stats.spd, mon.level);
    mon.stats.spc = this.statValue(d.stats.spc, mon.level);
    if (keepRatio) mon.hp = Math.round(mon.maxhp * (mon.hp / Math.max(1, oldMax)));
    else mon.hp += (mon.maxhp - oldMax);
    mon.hp = Math.min(mon.maxhp, Math.max(0, mon.hp));
  },

  gainExp(mon, amount) {
    const msgs = [];
    mon.exp += amount;
    while (mon.level < 100 && mon.exp >= this.expForLevel(mon.level + 1)) {
      mon.level++;
      this.recomputeStats(mon, false);
      msgs.push(`${DEX[mon.species].name} grew to LV.${mon.level}!`);
      // learn new moves
      const learn = (DEX[mon.species].learn || {})[mon.level];
      if (learn) learn.forEach(id => {
        if (mon.moves.some(m => m.id === id)) return;
        const entry = { id, pp: MOVES[id].pp, maxpp: MOVES[id].pp };
        if (mon.moves.length < 4) mon.moves.push(entry);
        else { mon.moves.shift(); mon.moves.push(entry); }
        msgs.push(`${DEX[mon.species].name} learned ${MOVES[id].name}!`);
      });
      // evolution
      const evo = DEX[mon.species].evolve;
      if (evo && mon.level >= evo.level) {
        const from = DEX[mon.species].name, to = DEX[evo.into].name;
        mon.species = evo.into;
        this.recomputeStats(mon, true);
        msgs.push(`What? ${from} is evolving!`, `${from} evolved into ${to}!`);
      }
    }
    return msgs;
  },

  activePokemon() { return this.party.find(p => p.hp > 0) || this.party[0]; },

  /* ---------- bag ---------- */
  addItem(id, qty = 1) { this.bag[id] = (this.bag[id] || 0) + qty; },
  removeItem(id) { if (this.bag[id]) { this.bag[id]--; if (this.bag[id] <= 0) delete this.bag[id]; } },
  bagList() { return Object.keys(this.bag).map(id => ({ id, qty: this.bag[id] })); },

  addToParty(mon) {
    if (this.party.length < 6) this.party.push(mon);
    // (no PC box in this build; extras would be released — party cap is generous)
  },

  /* ---------- world events ---------- */
  triggerEncounter(x, y) {
    if (!this.party.length) return;
    const region = y >= 16 ? "south" : "north";
    const table = WORLD.encounters[region];
    const species = table[Math.floor(Math.random() * table.length)];
    const lvl = region === "south" ? 3 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 4);
    const enemy = this.createPokemon(species, lvl);
    this.mode = "battle";
    Battle.start(enemy);
  },

  readSign(text) { this.dialog([text]); },

  useDoor(kind) {
    if (kind === "center") {
      this.dialog(["Welcome to the POKéMON CENTER!", "We restored your POKéMON to", "full health. We hope to see", "you again!"], () => this.healParty());
    } else if (kind === "mart") {
      this.addItem("pokeball", 5); this.addItem("potion", 3);
      this.dialog(["POKé MART:", "Here, take 5 POKé BALLS and", "3 POTIONS on the house!", "Good luck out there!"]);
    } else if (kind === "lab") {
      if (!this.flags.hasStarter) this.startStarterSelect();
      else this.dialog(["PROF. OAK: Your POKéDEX is", "coming along nicely!", "Catch them all!"]);
    }
  },

  healParty() {
    this.party.forEach(p => { p.hp = p.maxhp; p.moves.forEach(m => m.pp = m.maxpp); p.statMods = { atk: 0, def: 0, spd: 0 }; });
    this.save();
  },

  endBattle(result) {
    this.party.forEach(p => p.statMods = { atk: 0, def: 0, spd: 0 });
    if (result === "lost") {
      // whiteout: heal and return to start
      this.healParty();
      Engine.player.x = WORLD.playerStart.x;
      Engine.player.y = WORLD.playerStart.y;
      Engine.player.moving = false; Engine.held = null;
    }
    this.save();
    this.mode = "overworld";
    this.setOverlay("");
  },

  /* ---------- dialogue ---------- */
  dialog(pages, onDone) {
    this.dlgPages = pages.slice();
    this.dlgIndex = 0;
    this.dlgDone = onDone || null;
    this.mode = "dialogue";
  },
  advanceDialog() {
    this.dlgIndex++;
    if (this.dlgIndex >= this.dlgPages.length) {
      const cb = this.dlgDone; this.dlgDone = null;
      this.mode = "overworld"; this.setOverlay("");
      if (cb) cb();
    }
  },

  /* ---------- starter ---------- */
  startStarterSelect() {
    this.dialog([
      "PROF. OAK: Hello! Welcome to",
      "the world of POKéMON!",
      "There are three POKéMON here.",
      "Choose your partner!",
    ], () => { this.mode = "starter"; this.starterIndex = 1; });
  },
  confirmStarter() {
    const species = STARTERS[this.starterIndex];
    const mon = this.createPokemon(species, 5);
    this.party = [mon];
    this.bag = {}; this.addItem("pokeball", 5); this.addItem("potion", 3);
    this.flags.hasStarter = true;
    this.dialog([
      `You chose ${DEX[species].name}!`,
      "PROF. OAK: That's a fine choice!",
      "Head north into the tall grass", "to find wild POKéMON. Good luck!",
    ], () => { this.save(); this.mode = "overworld"; });
  },

  /* ---------- start menu ---------- */
  openPartyMenu() {
    this.mode = "startmenu"; this.menuIndex = 0;
  },

  /* ---------- save / load ---------- */
  save() {
    try {
      const data = {
        party: this.party, bag: this.bag, flags: this.flags,
        pos: { x: Engine.player.x, y: Engine.player.y, dir: Engine.player.dir },
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {}
  },
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
  load() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!data) return false;
      this.party = data.party; this.bag = data.bag || {}; this.flags = data.flags || { hasStarter: true };
      Engine.player.x = data.pos.x; Engine.player.y = data.pos.y; Engine.player.dir = data.pos.dir || "down";
      // backfill statMods if missing
      this.party.forEach(p => { if (!p.statMods) p.statMods = { atk: 0, def: 0, spd: 0 }; });
      return true;
    } catch (e) { return false; }
  },

  /* ---------- input ---------- */
  input(name, isPress) {
    if (isPress) navigator.vibrate && navigator.vibrate(8);
    switch (this.mode) {
      case "title":
        if (isPress && (name === "a" || name === "start")) this.startGame();
        break;
      case "starter":
        if (!isPress) break;
        if (name === "left") this.starterIndex = (this.starterIndex + 2) % 3;
        if (name === "right") this.starterIndex = (this.starterIndex + 1) % 3;
        if (name === "a") this.confirmStarter();
        break;
      case "dialogue":
        if (isPress && (name === "a" || name === "b")) this.advanceDialog();
        break;
      case "startmenu":  if (isPress) this.navStartMenu(name); break;
      case "partyview":  if (isPress && (name === "b")) { this.mode = "startmenu"; } break;
      case "bagview":    if (isPress && (name === "b")) { this.mode = "startmenu"; } break;
      case "overworld":
        if (isPress) Engine.onPress(name); else Engine.onRelease(name);
        break;
      case "battle":
        if (isPress) Battle.onPress(name);
        break;
    }
  },

  navStartMenu(name) {
    const items = ["POKéMON", "BAG", "SAVE", "CLOSE"];
    if (name === "up") this.menuIndex = (this.menuIndex + items.length - 1) % items.length;
    if (name === "down") this.menuIndex = (this.menuIndex + 1) % items.length;
    if (name === "b") { this.mode = "overworld"; this.setOverlay(""); return; }
    if (name === "a") {
      const sel = items[this.menuIndex];
      if (sel === "POKéMON") this.mode = "partyview";
      else if (sel === "BAG") this.mode = "bagview";
      else if (sel === "SAVE") { this.save(); this.dialog(["Game saved!"]); }
      else { this.mode = "overworld"; this.setOverlay(""); }
    }
  },

  startGame() {
    if (this.hasSave() && this.load()) { this.mode = "overworld"; }
    else { this.startStarterSelect(); }
  },

  requestRender() {},

  /* ---------- rendering / loop ---------- */
  setOverlay(html) { if (this.overlay.innerHTML !== html) this.overlay.innerHTML = html; },

  loop() {
    // update
    if (this.mode === "overworld") Engine.update();
    else if (this.mode === "battle") Battle.update();

    // render
    const ctx = this.ctx;
    if (this.mode === "title") { this.renderTitle(ctx); this.renderTitleOverlay(); }
    else if (this.mode === "starter") { Engine.render(ctx); this.renderStarter(ctx); }
    else if (this.mode === "battle") { Battle.render(ctx); }
    else { Engine.render(ctx); this.renderUIOverlay(); }

    requestAnimationFrame(() => this.loop());
  },

  renderUIOverlay() {
    const s = this.scale;
    const bw = 160 * s;
    if (this.mode === "dialogue") {
      const box = `left:0;bottom:0;width:${bw}px;height:${44*s}px;padding:${6*s}px;font-size:${Math.max(11,7*s)}px;`;
      this.setOverlay(`<div class="dialogue" style="${box}">${this.esc(this.dlgPages[this.dlgIndex] || "")}<div style="position:absolute;right:${6*s}px;bottom:${4*s}px;font-size:.8em;">▼</div></div>`);
    } else if (this.mode === "startmenu") {
      const items = ["POKéMON", "BAG", "SAVE", "CLOSE"];
      const rows = items.map((it,i)=>`<div class="item ${i===this.menuIndex?'sel':''}">${it}</div>`).join("");
      this.setOverlay(`<div class="menu" style="right:${4*s}px;top:${4*s}px;width:${70*s}px;padding:${6*s}px;font-size:${Math.max(11,7*s)}px;">${rows}</div>`);
    } else if (this.mode === "partyview") {
      const rows = this.party.map(p=>{
        const r = p.hp/p.maxhp; const col = r>0.5?'#2a8a2a':r>0.2?'#b8860b':'#c0301a';
        return `<div style="margin-bottom:${4*s}px;">${DEX[p.species].name} <span style="float:right;">L${p.level}</span><br><span style="color:${col};">HP ${p.hp}/${p.maxhp}</span></div>`;
      }).join("");
      this.setOverlay(`<div class="dialogue" style="left:${4*s}px;top:${4*s}px;width:${152*s}px;padding:${8*s}px;font-size:${Math.max(11,7*s)}px;">${rows}<div style="font-size:.8em;opacity:.6;">B: back</div></div>`);
    } else if (this.mode === "bagview") {
      const bag = this.bagList();
      const rows = bag.length ? bag.map(b=>`<div>${ITEMS[b.id].name} <span style="float:right;">x${b.qty}</span><br><span style="font-size:.78em;opacity:.7;">${ITEMS[b.id].desc}</span></div>`).join("") : "Empty!";
      this.setOverlay(`<div class="dialogue" style="left:${4*s}px;top:${4*s}px;width:${152*s}px;padding:${8*s}px;font-size:${Math.max(11,7*s)}px;">${rows}<div style="font-size:.8em;opacity:.6;margin-top:${4*s}px;">B: back</div></div>`);
    } else {
      this.setOverlay("");
    }
  },

  renderTitle(ctx) {
    ctx.fillStyle = "#3068c0"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#a0d8f0"; ctx.fillRect(0, 0, VIEW_W, 60);
    // big red title
    ctx.fillStyle = "#e0392b"; ctx.font = "bold 22px monospace"; ctx.textAlign = "center";
    ctx.fillText("POKéMON", 80, 34);
    ctx.fillStyle = "#f8d030"; ctx.fillText("POKéMON", 79, 33);
    ctx.font = "bold 13px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("RED — MOBILE", 80, 50);
    // a couple of decorative sprites
    drawGrid(ctx, monSprite("charmander"), 18, 72, 2.4);
    drawGrid(ctx, monSprite("pikachu"), 108, 74, 2.4);
    // pokeball
    ctx.fillStyle = "#f8f8f8"; ctx.beginPath(); ctx.arc(80, 92, 14, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#e0392b"; ctx.beginPath(); ctx.arc(80, 92, 14, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#202020"; ctx.fillRect(66, 91, 28, 2);
    ctx.beginPath(); ctx.arc(80, 92, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(80, 92, 2, 0, Math.PI*2); ctx.fill();
    ctx.textAlign = "left";
  },
  renderTitleOverlay() {
    const s = this.scale;
    const blink = (Math.floor(Date.now() / 500) % 2) === 0;
    const sub = this.hasSave() ? "CONTINUE — press A" : "NEW GAME — press A";
    this.setOverlay(`<div style="position:absolute;left:0;bottom:${22*s}px;width:${160*s}px;text-align:center;color:#fff;font-weight:bold;font-size:${Math.max(11,7*s)}px;opacity:${blink?1:0.25};">${sub}</div>`);
  },

  renderStarter(ctx) {
    ctx.fillStyle = "rgba(20,20,20,0.55)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(10, 18, 140, 88);
    ctx.strokeStyle = "#202020"; ctx.lineWidth = 2; ctx.strokeRect(10, 18, 140, 88);
    const xs = [28, 68, 108];
    STARTERS.forEach((sp, i) => {
      if (i === this.starterIndex) { ctx.fillStyle = "#f8d030"; ctx.fillRect(xs[i]-4, 26, 36, 52); }
      drawGrid(ctx, monSprite(sp), xs[i] - 4, 26, 2.2);
    });
    ctx.fillStyle = "#202020"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
    ctx.fillText(DEX[STARTERS[this.starterIndex]].name, 80, 92);
    ctx.font = "7px monospace";
    ctx.fillText("◀  choose  ▶      A: pick", 80, 102);
    ctx.textAlign = "left";
    this.setOverlay("");
  },

  esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"); },

  /* ---------- setup ---------- */
  resize() {
    const wrap = document.getElementById("screen-wrap");
    const availW = wrap.clientWidth, availH = wrap.clientHeight;
    const scale = Math.max(1, Math.min(availW / VIEW_W, availH / VIEW_H));
    this.scale = scale;
    this.canvas.style.width = (VIEW_W * scale) + "px";
    this.canvas.style.height = (VIEW_H * scale) + "px";
    // align overlay to the (centered) canvas
    requestAnimationFrame(() => {
      this.overlay.style.left = this.canvas.offsetLeft + "px";
      this.overlay.style.top = this.canvas.offsetTop + "px";
      this.overlay.style.width = this.canvas.style.width;
      this.overlay.style.height = this.canvas.style.height;
    });
  },

  init() {
    this.canvas = document.getElementById("screen");
    this.ctx = this.canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.overlay = document.getElementById("overlay");

    Engine.init();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 200));

    this.bindControls();
    this.bindKeyboard();

    this.loop();
  },

  bindControls() {
    const press = (name) => this.input(name, true);
    const release = (name) => this.input(name, false);

    document.querySelectorAll(".dbtn[data-dir]").forEach(btn => {
      const dir = btn.dataset.dir;
      const down = (e) => { e.preventDefault(); btn.classList.add("pressed"); press(dir); };
      const up = (e) => { e.preventDefault(); btn.classList.remove("pressed"); release(dir); };
      btn.addEventListener("touchstart", down, { passive: false });
      btn.addEventListener("touchend", up, { passive: false });
      btn.addEventListener("touchcancel", up, { passive: false });
      btn.addEventListener("mousedown", down);
      btn.addEventListener("mouseup", up);
      btn.addEventListener("mouseleave", (e) => { if (btn.classList.contains("pressed")) up(e); });
    });

    document.querySelectorAll(".abtn[data-btn]").forEach(btn => {
      const name = btn.dataset.btn;
      const down = (e) => { e.preventDefault(); btn.classList.add("pressed"); press(name); };
      const up = (e) => { e.preventDefault(); btn.classList.remove("pressed"); release(name); };
      btn.addEventListener("touchstart", down, { passive: false });
      btn.addEventListener("touchend", up, { passive: false });
      btn.addEventListener("touchcancel", up, { passive: false });
      btn.addEventListener("mousedown", down);
      btn.addEventListener("mouseup", up);
    });
  },

  bindKeyboard() {
    const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
                  z: "a", Z: "a", x: "b", X: "b", Enter: "start", " ": "a",
                  w: "up", a: "left", s: "down", d: "right" };
    const downKeys = new Set();
    window.addEventListener("keydown", (e) => {
      const n = map[e.key]; if (!n) return; e.preventDefault();
      if (downKeys.has(e.key)) return; downKeys.add(e.key);
      this.input(n, true);
    });
    window.addEventListener("keyup", (e) => {
      const n = map[e.key]; if (!n) return; downKeys.delete(e.key);
      this.input(n, false);
    });
  },
};

window.addEventListener("load", () => Game.init());
