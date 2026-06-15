/* ============================================================
   battle.js — turn-based battles (Gen 1 flavoured).
   Scene drawn on canvas; text & menus via the HTML overlay.
   ============================================================ */

const Battle = {
  enemy: null,        // wild Pokémon instance
  player: null,       // active party Pokémon
  isWild: true,
  phase: "msg",       // msg | menu | fight | bag | switch
  menuIndex: 0,
  moveIndex: 0,
  bagIndex: 0,
  switchIndex: 0,
  msgQueue: [],
  onMsgDone: null,
  enemyDispHP: 0,
  playerDispHP: 0,
  ballShake: 0,
  ended: false,
  result: null,       // "won" | "caught" | "ran" | "lost"
  introBounce: 0,

  start(enemyMon) {
    this.enemy = enemyMon;
    this.isWild = true;
    this.player = Game.activePokemon();
    this.enemyDispHP = enemyMon.hp;
    this.playerDispHP = this.player.hp;
    this.ended = false;
    this.result = null;
    this.menuIndex = 0; this.moveIndex = 0;
    this.introBounce = 0;
    this.say(
      [`Wild ${DEX[this.enemy.species].name} appeared!`,
       `Go! ${DEX[this.player.species].name}!`],
      () => this.toMenu()
    );
  },

  /* ---- message queue ---- */
  say(messages, done) {
    this.msgQueue = Array.isArray(messages) ? messages.slice() : [messages];
    this.onMsgDone = done || null;
    this.phase = "msg";
    this.curMsg = this.msgQueue.shift();
    Game.requestRender();
  },
  advanceMsg() {
    if (this.msgQueue.length) { this.curMsg = this.msgQueue.shift(); Game.requestRender(); return; }
    const cb = this.onMsgDone; this.onMsgDone = null; this.curMsg = null;
    if (cb) cb();
  },

  toMenu() {
    if (this.ended) return;
    this.phase = "menu";
    this.menuIndex = 0;
    Game.requestRender();
  },

  /* ---- input ---- */
  onPress(input) {
    switch (this.phase) {
      case "msg":
        if (input === "a" || input === "b") this.advanceMsg();
        break;
      case "menu":   this.navMenu(input); break;
      case "fight":  this.navFight(input); break;
      case "bag":    this.navBag(input); break;
      case "switch": this.navSwitch(input); break;
    }
  },

  navMenu(input) {
    // 2x2 grid: 0 FIGHT 1 BAG / 2 PKMN 3 RUN
    if (input === "left" || input === "right") this.menuIndex ^= 1;
    else if (input === "up" || input === "down") this.menuIndex ^= 2;
    else if (input === "a") {
      if (this.menuIndex === 0) { this.phase = "fight"; this.moveIndex = 0; }
      else if (this.menuIndex === 1) { this.phase = "bag"; this.bagIndex = 0; }
      else if (this.menuIndex === 2) { this.openSwitch(); }
      else if (this.menuIndex === 3) { this.tryRun(); }
    }
    Game.requestRender();
  },

  navFight(input) {
    const moves = this.player.moves;
    if (input === "up")   this.moveIndex = (this.moveIndex + moves.length - 1) % moves.length;
    if (input === "down") this.moveIndex = (this.moveIndex + 1) % moves.length;
    if (input === "b") { this.toMenu(); return; }
    if (input === "a") {
      const mv = moves[this.moveIndex];
      if (mv.pp <= 0) { this.say(["No PP left for", "that move!"], () => this.toMenu()); return; }
      this.playerTurn({ type: "move", move: mv });
      return;
    }
    Game.requestRender();
  },

  navBag(input) {
    const bag = Game.bagList();
    if (!bag.length && input === "b") { this.toMenu(); return; }
    if (input === "up")   this.bagIndex = (this.bagIndex + bag.length - 1) % bag.length;
    if (input === "down") this.bagIndex = (this.bagIndex + 1) % bag.length;
    if (input === "b") { this.toMenu(); return; }
    if (input === "a" && bag.length) {
      const entry = bag[this.bagIndex];
      const item = ITEMS[entry.id];
      if (item.kind === "ball") { Game.removeItem(entry.id); this.playerTurn({ type: "ball", id: entry.id }); }
      else if (item.kind === "heal") {
        if (this.player.hp >= this.player.maxhp) { this.say(["HP is already full!"], () => this.phase="bag"); return; }
        Game.removeItem(entry.id);
        this.playerTurn({ type: "heal", id: entry.id });
      }
      return;
    }
    Game.requestRender();
  },

  openSwitch() {
    const usable = Game.party.filter(p => p.hp > 0 && p !== this.player);
    if (!usable.length) { this.say(["No other POKéMON", "can fight!"], () => this.toMenu()); return; }
    this.phase = "switch"; this.switchIndex = 0; Game.requestRender();
  },
  navSwitch(input) {
    const party = Game.party;
    if (input === "up")   this.switchIndex = (this.switchIndex + party.length - 1) % party.length;
    if (input === "down") this.switchIndex = (this.switchIndex + 1) % party.length;
    if (input === "b") { this.toMenu(); return; }
    if (input === "a") {
      const mon = party[this.switchIndex];
      if (mon === this.player) { this.say(["It's already in", "battle!"], () => this.phase="switch"); return; }
      if (mon.hp <= 0) { this.say([`${DEX[mon.species].name} has`, "no energy left!"], () => this.phase="switch"); return; }
      this.playerTurn({ type: "switch", mon });
      return;
    }
    Game.requestRender();
  },

  /* ---- turn resolution ---- */
  playerTurn(action) {
    this.pendingPlayer = action;
    const enemyAction = { type: "move", move: this.pickEnemyMove() };

    // Catch / heal / switch happen before the enemy's move for that turn.
    if (action.type === "ball") { this.resolveBall(action.id); return; }
    if (action.type === "heal") {
      const item = ITEMS[action.id];
      const before = this.player.hp;
      this.player.hp = Math.min(this.player.maxhp, this.player.hp + item.amount);
      this.say([`Used ${item.name}.`, `${DEX[this.player.species].name} recovered ${this.player.hp - before} HP!`],
        () => this.enemyThenMenu(enemyAction));
      return;
    }
    if (action.type === "switch") {
      const idx = Game.party.indexOf(action.mon);
      Game.party[0] = action.mon; Game.party[idx] = this.player; // bring chosen to front
      this.player = action.mon;
      this.playerDispHP = this.player.hp;
      this.say([`Go! ${DEX[this.player.species].name}!`],
        () => this.enemyThenMenu(enemyAction));
      return;
    }

    // Two moves: order by speed.
    const playerFirst = this.effSpeed(this.player) >= this.effSpeed(this.enemy);
    const seq = playerFirst
      ? [["player", action.move], ["enemy", enemyAction.move]]
      : [["enemy", enemyAction.move], ["player", action.move]];
    this.runMoveSequence(seq);
  },

  enemyThenMenu(enemyAction) {
    if (this.ended) return;
    this.doMove("enemy", enemyAction.move, () => {
      if (this.checkPlayerFaint()) return;
      this.toMenu();
    });
  },

  runMoveSequence(seq) {
    const step = (i) => {
      if (this.ended || i >= seq.length) { if (!this.ended) this.toMenu(); return; }
      const [who, move] = seq[i];
      const attacker = who === "player" ? this.player : this.enemy;
      if (attacker.hp <= 0) { step(i + 1); return; } // fainted before acting
      this.doMove(who, move, () => {
        if (who === "player" && this.checkEnemyFaint()) return;
        if (who === "enemy" && this.checkPlayerFaint()) return;
        step(i + 1);
      });
    };
    step(0);
  },

  doMove(who, move, done) {
    const attacker = who === "player" ? this.player : this.enemy;
    const defender = who === "player" ? this.enemy : this.player;
    move.pp = Math.max(0, move.pp - 1);
    const info = MOVES[move.id];
    const name = DEX[attacker.species].name;
    const msgs = [`${who === "enemy" ? "Enemy " : ""}${name} used ${info.name}!`];

    // accuracy
    if (Math.random() * 100 > info.acc) {
      msgs.push("But it missed!");
      this.say(msgs, done); return;
    }

    if (info.cat === "status") {
      this.applyStatus(info, defender, who, msgs);
      this.say(msgs, done); return;
    }

    const dmg = this.calcDamage(attacker, defender, info);
    const eff = typeEffectiveness(info.type, DEX[defender.species].types);
    defender.hp = Math.max(0, defender.hp - dmg.amount);
    if (dmg.crit) msgs.push("A critical hit!");
    if (eff === 0) msgs.push("It doesn't affect it...");
    else if (eff > 1) msgs.push("It's super effective!");
    else if (eff < 1) msgs.push("It's not very effective...");

    this.say(msgs, done);
  },

  applyStatus(info, defender, who, msgs) {
    const dn = DEX[defender.species].name;
    const who2 = who === "player" ? "Enemy " : "";
    if (info.effect === "lowerAtk") { defender.statMods.atk = Math.max(-3, defender.statMods.atk - 1); msgs.push(`${who2}${dn}'s ATTACK fell!`); }
    else if (info.effect === "lowerDef") { defender.statMods.def = Math.max(-3, defender.statMods.def - 1); msgs.push(`${who2}${dn}'s DEFENSE fell!`); }
    else if (info.effect === "lowerSpd") { defender.statMods.spd = Math.max(-3, defender.statMods.spd - 1); msgs.push(`${who2}${dn}'s SPEED fell!`); }
    else msgs.push("Nothing happened.");
  },

  calcDamage(attacker, defender, info) {
    const lvl = attacker.level;
    const isPhys = info.cat === "phys";
    const atk = this.effStat(attacker, isPhys ? "atk" : "spc");
    const def = this.effStat(defender, isPhys ? "def" : "spc");
    let base = Math.floor((((2 * lvl) / 5 + 2) * info.power * atk / Math.max(1, def)) / 50) + 2;
    // STAB
    if (DEX[attacker.species].types.includes(info.type)) base = Math.floor(base * 1.5);
    // type effectiveness
    base = Math.floor(base * typeEffectiveness(info.type, DEX[defender.species].types));
    // crit + random
    const crit = Math.random() < 0.0625;
    if (crit) base = Math.floor(base * 1.8);
    base = Math.floor(base * (0.85 + Math.random() * 0.15));
    return { amount: Math.max(typeEffectiveness(info.type, DEX[defender.species].types) === 0 ? 0 : 1, base), crit };
  },

  effStat(mon, key) {
    if (key === "spc") return mon.stats.spc;
    const mod = mon.statMods[key] || 0;
    const factor = mod >= 0 ? (2 + mod) / 2 : 2 / (2 - mod);
    return Math.floor(mon.stats[key] * factor);
  },
  effSpeed(mon) { return this.effStat(mon, "spd"); },

  pickEnemyMove() {
    const m = this.enemy.moves.filter(mv => mv.pp > 0);
    const pool = m.length ? m : this.enemy.moves;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  /* ---- catching ---- */
  resolveBall(id) {
    const ball = ITEMS[id];
    const e = this.enemy;
    const rate = DEX[e.species].catchRate;
    // Gen-1-ish: higher when low HP.
    const hpFactor = (3 * e.maxhp - 2 * e.hp) / (3 * e.maxhp);
    const chance = Math.min(1, (rate / 255) * ball.rate * (0.4 + 0.8 * hpFactor) + 0.05);
    const caught = Math.random() < chance;
    const shakes = caught ? 3 : Math.floor(Math.random() * 3);
    this.ballShake = 0;
    this.say([`You used a ${ball.name}!`], () => {
      this.animateShakes(shakes, () => {
        if (caught) {
          this.result = "caught"; this.ended = true;
          Game.addToParty(e);
          this.say([`Gotcha!`, `${DEX[e.species].name} was caught!`], () => Game.endBattle("caught"));
        } else {
          const txt = shakes === 0 ? "Oh no! It broke free!" :
                      shakes === 1 ? "Aww! It appeared to be caught!" :
                      "Aargh! So close too!";
          this.say([txt], () => {
            // enemy gets a free move after a failed catch
            this.doMove("enemy", this.pickEnemyMove(), () => {
              if (this.checkPlayerFaint()) return; this.toMenu();
            });
          });
        }
      });
    });
  },
  animateShakes(n, done) {
    // simple timed shakes handled in update via ballShakeTarget
    this.ballShakeTarget = n; this.ballShakeCount = 0; this.ballTimer = 0;
    this.shakeDone = done; this.phase = "ballanim";
    Game.requestRender();
  },

  tryRun() {
    if (!this.isWild) { this.say(["Can't run from a", "TRAINER battle!"], () => this.toMenu()); return; }
    const odds = this.effSpeed(this.player) >= this.effSpeed(this.enemy) ? 0.9 : 0.55;
    if (Math.random() < odds) {
      this.result = "ran"; this.ended = true;
      this.say(["Got away safely!"], () => Game.endBattle("ran"));
    } else {
      this.say(["Can't escape!"], () => {
        this.doMove("enemy", this.pickEnemyMove(), () => {
          if (this.checkPlayerFaint()) return; this.toMenu();
        });
      });
    }
  },

  /* ---- faint handling ---- */
  checkEnemyFaint() {
    if (this.enemy.hp > 0) return false;
    this.ended = true; this.result = "won";
    const gained = Math.max(1, Math.floor(DEX[this.enemy.species].base * this.enemy.level / 7));
    this.say([`Wild ${DEX[this.enemy.species].name} fainted!`,
              `${DEX[this.player.species].name} gained`, `${gained} EXP. Points!`], () => {
      const levelMsgs = Game.gainExp(this.player, gained);
      if (levelMsgs.length) this.say(levelMsgs, () => Game.endBattle("won"));
      else Game.endBattle("won");
    });
    return true;
  },
  checkPlayerFaint() {
    if (this.player.hp > 0) return false;
    this.say([`${DEX[this.player.species].name} fainted!`], () => {
      const next = Game.party.find(p => p.hp > 0);
      if (next) {
        this.player = next;
        Game.party.splice(Game.party.indexOf(next), 1);
        Game.party.unshift(next);
        this.playerDispHP = next.hp;
        this.say([`Go! ${DEX[next.species].name}!`], () => this.toMenu());
      } else {
        this.ended = true; this.result = "lost";
        this.say(["You have no POKéMON", "left! You scurry back", "to PALLET TOWN..."],
          () => Game.endBattle("lost"));
      }
    });
    return true;
  },

  /* ---- per-frame ---- */
  update() {
    // animate HP bars
    this.enemyDispHP += (this.enemy.hp - this.enemyDispHP) * 0.25;
    if (Math.abs(this.enemyDispHP - this.enemy.hp) < 0.5) this.enemyDispHP = this.enemy.hp;
    this.playerDispHP += (this.player.hp - this.playerDispHP) * 0.25;
    if (Math.abs(this.playerDispHP - this.player.hp) < 0.5) this.playerDispHP = this.player.hp;
    this.introBounce = (this.introBounce + 1) % 1000;

    if (this.phase === "ballanim") {
      this.ballTimer++;
      if (this.ballTimer > 22) {
        this.ballTimer = 0; this.ballShakeCount++;
        if (this.ballShakeCount > this.ballShakeTarget) {
          const cb = this.shakeDone; this.shakeDone = null; if (cb) cb();
        }
      }
      Game.requestRender();
    }
  },

  /* ---- rendering ---- */
  render(ctx) {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    // background
    ctx.fillStyle = "#f8f8e8"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#d0e8b0"; ctx.fillRect(0, 70, VIEW_W, VIEW_H - 70);

    // enemy platform + sprite (top-right)
    ctx.fillStyle = "#b8d888"; ctx.beginPath();
    ctx.ellipse(118, 64, 34, 9, 0, 0, Math.PI * 2); ctx.fill();
    const bob = Math.sin(this.introBounce * 0.08) * 1.5;
    if (this.phase !== "ballanim") {
      drawGrid(ctx, monSprite(this.enemy.species), 96, 18 + bob, 2.6);
    } else {
      this.drawBall(ctx, 110, 38);
    }

    // player sprite (bottom-left, back view approximated by the front sprite, larger)
    ctx.fillStyle = "#b8d888"; ctx.beginPath();
    ctx.ellipse(40, 118, 36, 10, 0, 0, Math.PI * 2); ctx.fill();
    drawGrid(ctx, monSprite(this.player.species), 14, 74, 3);

    // HP boxes
    this.drawHPBox(ctx, this.enemy, this.enemyDispHP, 6, 8, false);
    this.drawHPBox(ctx, this.player, this.playerDispHP, 84, 78, true);

    // bottom UI handled by overlay
    Game.setOverlay(this.overlayHTML());
  },

  drawBall(ctx, x, y) {
    const wobble = (this.ballShakeCount <= this.ballShakeTarget)
      ? Math.sin(this.ballTimer * 0.5) * (this.ballTimer < 11 ? 0.5 : 0) : 0;
    ctx.save();
    ctx.translate(x + 8, y + 8);
    ctx.rotate(wobble);
    ctx.translate(-8, -8);
    ctx.fillStyle = "#e0392b"; ctx.fillRect(x, y, 16, 8);
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(x, y + 8, 16, 8);
    ctx.fillStyle = "#202020"; ctx.fillRect(x, y + 7, 16, 2);
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(x + 6, y + 6, 4, 4);
    ctx.fillStyle = "#202020"; ctx.fillRect(x + 7, y + 7, 2, 2);
    ctx.restore();
  },

  drawHPBox(ctx, mon, dispHP, x, y, showHPNum) {
    const w = 70, h = showHPNum ? 26 : 22;
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#202020"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#202020"; ctx.font = "bold 8px monospace";
    ctx.fillText(DEX[mon.species].name, x + 4, y + 9);
    ctx.fillText("L" + mon.level, x + w - 18, y + 9);
    // HP bar
    const bx = x + 14, by = y + 13, bw = 48, bh = 4;
    ctx.fillStyle = "#404040"; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = "#d8d8d8"; ctx.fillRect(bx, by, bw, bh);
    const ratio = Math.max(0, dispHP / mon.maxhp);
    ctx.fillStyle = ratio > 0.5 ? "#48d048" : ratio > 0.2 ? "#f8d030" : "#e0392b";
    ctx.fillRect(bx, by, Math.round(bw * ratio), bh);
    ctx.fillStyle = "#202020"; ctx.font = "6px monospace";
    ctx.fillText("HP", x + 3, y + 17);
    if (showHPNum) {
      ctx.font = "bold 8px monospace";
      ctx.fillText(`${Math.ceil(dispHP)}/${mon.maxhp}`, x + w - 34, y + 24);
    }
  },

  overlayHTML() {
    const scale = Game.scale;
    const boxStyle = `left:0;bottom:0;width:${160*scale}px;height:${44*scale}px;font-size:${Math.max(11,7*scale)}px;`;
    if (this.phase === "msg" || this.phase === "ballanim") {
      const t = this.curMsg ? this.curMsg : "";
      return `<div class="dialogue" style="${boxStyle}padding:${6*scale}px;">${this.esc(t)}</div>`;
    }
    if (this.phase === "menu") {
      const items = ["FIGHT","BAG","POKéMON","RUN"];
      const cells = items.map((it,i)=>`<span class="item ${i===this.menuIndex?'sel':''}">${it}</span>`);
      return `<div class="dialogue" style="${boxStyle}padding:${6*scale}px;display:grid;grid-template-columns:1fr 1fr;align-content:center;gap:${2*scale}px ${10*scale}px;">${cells.join("")}</div>`;
    }
    if (this.phase === "fight") {
      const rows = this.player.moves.map((m,i)=>{
        const info = MOVES[m.id];
        return `<div class="item ${i===this.moveIndex?'sel':''}">${info.name}<span style="float:right;font-size:0.8em;">${m.pp}/${m.maxpp} ${info.type.slice(0,3).toUpperCase()}</span></div>`;
      }).join("");
      return `<div class="dialogue" style="${boxStyle}padding:${5*scale}px;overflow:hidden;">${rows}<div style="font-size:0.75em;opacity:.6;">B: back</div></div>`;
    }
    if (this.phase === "bag") {
      const bag = Game.bagList();
      if (!bag.length) return `<div class="dialogue" style="${boxStyle}padding:${6*scale}px;">No items!<br><span style="font-size:.8em;opacity:.6;">B: back</span></div>`;
      const rows = bag.map((b,i)=>`<div class="item ${i===this.bagIndex?'sel':''}">${ITEMS[b.id].name}<span style="float:right;">x${b.qty}</span></div>`).join("");
      return `<div class="dialogue" style="${boxStyle}padding:${5*scale}px;overflow:hidden;">${rows}<div style="font-size:.75em;opacity:.6;">B: back</div></div>`;
    }
    if (this.phase === "switch") {
      const rows = Game.party.map((p,i)=>`<div class="item ${i===this.switchIndex?'sel':''}">${DEX[p.species].name} <span style="float:right;">L${p.level} ${p.hp}/${p.maxhp}${p.hp<=0?' FNT':''}</span></div>`).join("");
      return `<div class="dialogue" style="${boxStyle}padding:${5*scale}px;overflow:hidden;">${rows}<div style="font-size:.75em;opacity:.6;">B: back</div></div>`;
    }
    return "";
  },

  esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\n/g,"<br>"); },
};
