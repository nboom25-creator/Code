/* ============================================================
   battle.js — turn-based battles (Gen 1 flavoured).
   Scene drawn on canvas; text & menus via the HTML overlay.
   ============================================================ */

const Battle = {
  TBOX: { x: 2, y: 112, w: 236, h: 46 }, // bottom ~30% message/menu frame
  TYPE_MS: 50,                           // ms per character (0.05s typewriter)
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
    this._setMsg(this.msgQueue.shift());
    Game.requestRender();
  },
  // Begin typing a new line.
  _setMsg(t) { this.curMsg = t || ""; this.typeStart = Date.now(); this.typeFull = false; },
  // Characters revealed so far (the letter-by-letter typewriter).
  visibleMsg() {
    const full = this.curMsg || "";
    if (this.typeFull) return full;
    return full.slice(0, Math.floor((Date.now() - this.typeStart) / Battle.TYPE_MS));
  },
  msgFullyShown() { return this.visibleMsg().length >= (this.curMsg || "").length; },
  advanceMsg() {
    if (this.msgQueue.length) { this._setMsg(this.msgQueue.shift()); Game.requestRender(); return; }
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
        if (input === "a" || input === "b") {
          if (!this.msgFullyShown()) this.typeFull = true; // reveal instantly
          else this.advanceMsg();
        }
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
      // Gen-1 layout: 0 FIGHT  1 PkMn / 2 ITEM  3 RUN
      if (this.menuIndex === 0) { this.phase = "fight"; this.moveIndex = 0; }
      else if (this.menuIndex === 1) { this.openSwitch(); }
      else if (this.menuIndex === 2) { this.phase = "bag"; this.bagIndex = 0; }
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

  /* ---- rendering (all on-canvas, GBA-native 240x160) ---- */
  render(ctx) {
    Game.setOverlay("");
    // Backgrounds: white upper, barely-green lower, brick divider between.
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#eef2e2"; ctx.fillRect(0, 76, VIEW_W, 42);
    this.drawBrickDivider(ctx, 74);

    // platform ovals (line-drawn)
    this.drawPlatform(ctx, 182, 72, 44, 10);
    this.drawPlatform(ctx, 58, 116, 48, 11);

    // enemy (top-right) — front sprite or ball during a throw
    const bob = Math.round(Math.sin(this.introBounce * 0.08) * 2);
    if (this.phase === "ballanim") this.drawBall(ctx, 172, 44);
    else drawGrid(ctx, monSprite(this.enemy.species), 150, 8 + bob, 4);

    // player (bottom-left) — rear sprite
    drawGrid(ctx, monBackSprite(this.player.species), 26, 54, 4);

    // status boxes
    this.drawStatusBox(ctx, this.enemy, this.enemyDispHP, 10, 14, 112, false);
    this.drawStatusBox(ctx, this.player, this.playerDispHP, 120, 80, 112, true);

    // bottom message / menu frame
    this.drawTextbox(ctx);
  },

  drawBrickDivider(ctx, y) {
    ctx.fillStyle = "#cdd6bb"; ctx.fillRect(0, y, VIEW_W, 3);
    ctx.fillStyle = "#a7b290"; ctx.fillRect(0, y, VIEW_W, 1);     // top mortar
    for (let x = 0; x < VIEW_W; x += 8) ctx.fillRect(x, y, 1, 3); // vertical mortar
    for (let x = 4; x < VIEW_W; x += 8) ctx.fillRect(x, y + 2, 1, 1);
  },

  drawPlatform(ctx, cx, cy, rx, ry) {
    ctx.strokeStyle = "#b7c29a"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx + 0.5, cy + 0.5, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "#d4dcc2";
    ctx.beginPath(); ctx.ellipse(cx + 0.5, cy + 0.5, rx - 3, ry - 2, 0, 0, Math.PI * 2); ctx.stroke();
  },

  drawBall(ctx, x, y) {
    const k = "#181818";
    ctx.fillStyle = "#e0392b"; ctx.fillRect(x, y, 16, 7);
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(x, y + 9, 16, 7);
    ctx.fillStyle = k; ctx.fillRect(x, y + 7, 16, 2);
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(x + 6, y + 6, 4, 4);
    ctx.fillStyle = k; ctx.fillRect(x + 5, y + 5, 6, 1); ctx.fillRect(x + 5, y + 10, 6, 1);
    ctx.fillRect(x + 7, y + 7, 2, 2);
  },

  /* HP / name box with the thick-baseline + thin-accent border. */
  drawStatusBox(ctx, mon, dispHP, x, y, w, showNums) {
    const k = "#181818";
    const h = showNums ? 30 : 22;
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(x, y, w, h);
    // border: 1px frame
    ctx.fillStyle = k;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
    ctx.fillRect(x, y + h - 1, w, 1);          // thick baseline
    ctx.fillRect(x + 2, y + h - 3, w - 4, 1);  // thin accent above baseline

    drawText(ctx, DEX[mon.species].name, x + 5, y + 4, k, 1);
    const lvl = ":L" + mon.level;
    drawText(ctx, lvl, x + w - 5 - textWidth(lvl), y + 4, k, 1);

    // HP bar
    const labelX = x + 5, barY = y + 13;
    drawText(ctx, "HP:", labelX, barY, "#d89000", 1);
    const bx = labelX + 20, by = barY + 1, bw = w - (bx - x) - 6, bh = 3;
    ctx.fillStyle = k; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = "#586850"; ctx.fillRect(bx, by, bw, bh);
    const ratio = Math.max(0, Math.min(1, dispHP / mon.maxhp));
    ctx.fillStyle = ratio > 0.5 ? "#4fc04f" : ratio > 0.2 ? "#f0b000" : "#e03020";
    ctx.fillRect(bx, by, Math.round(bw * ratio), bh);

    if (showNums) {
      const txt = `${Math.ceil(dispHP)}/${mon.maxhp}`;
      drawText(ctx, txt, x + w - 5 - textWidth(txt), y + h - 9, k, 1);
    }
  },

  /* The signature dual-line frame with rounded corner nodes. */
  drawFrame(ctx, x, y, w, h) {
    const k = "#181818";
    ctx.fillStyle = "#f8f8f8"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = k;
    // outer line
    ctx.fillRect(x + 1, y, w - 2, 1); ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
    ctx.fillRect(x, y + 1, 1, h - 2); ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
    // rounded corner nodes
    ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + w - 2, y + 1, 1, 1);
    ctx.fillRect(x + 1, y + h - 2, 1, 1); ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
    // inner accent line
    ctx.fillRect(x + 3, y + 2, w - 6, 1); ctx.fillRect(x + 3, y + h - 3, w - 6, 1);
    ctx.fillRect(x + 2, y + 3, 1, h - 6); ctx.fillRect(x + w - 3, y + 3, 1, h - 6);
  },

  drawTextbox(ctx) {
    const b = Battle.TBOX, x = b.x, y = b.y, w = b.w, h = b.h, k = "#181818";
    this.drawFrame(ctx, x, y, w, h);
    const tx = x + 10, ty = y + 8, divX = x + 138;

    if (this.phase === "msg" || this.phase === "ballanim") {
      drawTextLines(ctx, this.visibleMsg(), tx, ty, k, 1, 1, 3);
      if (this.phase === "msg" && this.msgFullyShown() && (Math.floor(Date.now() / 400) % 2))
        this.drawDownChevron(ctx, x + w - 12, y + h - 11);
      return;
    }

    if (this.phase === "menu") {
      drawTextLines(ctx, `What will\n${DEX[this.player.species].name} do?`, tx, ty + 4, k, 1, 1, 4);
      ctx.fillStyle = k; ctx.fillRect(divX, y + 5, 1, h - 10); // inner divider
      this.drawGridMenu(ctx, ["FIGHT", "PkMn", "ITEM", "RUN"], this.menuIndex,
        [[divX + 12, y + 10], [divX + 56, y + 10], [divX + 12, y + 26], [divX + 56, y + 26]]);
      return;
    }

    if (this.phase === "fight") {
      const rows = this.player.moves;
      rows.forEach((m, i) => {
        const ry = ty + i * 8;
        if (i === this.moveIndex) drawArrow(ctx, x + 4, ry, k, 1);
        drawText(ctx, MOVES[m.id].name, tx + 2, ry, k, 1);
      });
      ctx.fillStyle = k; ctx.fillRect(divX, y + 5, 1, h - 10);
      const mv = MOVES[rows[this.moveIndex].id];
      drawText(ctx, "PP " + rows[this.moveIndex].pp + "/" + rows[this.moveIndex].maxpp, divX + 8, y + 9, k, 1);
      drawText(ctx, "TYPE/", divX + 8, y + 22, k, 1);
      drawText(ctx, mv.type.toUpperCase(), divX + 8, y + 31, k, 1);
      return;
    }

    if (this.phase === "bag") {
      const bag = Game.bagList();
      if (!bag.length) { drawText(ctx, "No items!", tx, ty, k, 1); drawText(ctx, "B: BACK", tx, ty + 22, k, 1); return; }
      bag.forEach((b2, i) => {
        const ry = ty + i * 8;
        if (i === this.bagIndex) drawArrow(ctx, x + 4, ry, k, 1);
        drawText(ctx, ITEMS[b2.id].name, tx + 2, ry, k, 1);
        drawText(ctx, "*" + b2.qty, x + w - 30, ry, k, 1);
      });
      return;
    }

    if (this.phase === "switch") {
      Game.party.forEach((p, i) => {
        const ry = ty + i * 8;
        if (i === this.switchIndex) drawArrow(ctx, x + 4, ry, k, 1);
        drawText(ctx, DEX[p.species].name, tx + 2, ry, k, 1);
        drawText(ctx, ":L" + p.level + "  " + (p.hp <= 0 ? "FNT" : p.hp + "/" + p.maxhp),
          x + 120, ry, k, 1);
      });
      return;
    }
  },

  drawGridMenu(ctx, items, sel, positions) {
    const k = "#181818";
    items.forEach((it, i) => {
      const [px, py] = positions[i];
      if (i === sel) drawArrow(ctx, px - 8, py, k, 1);
      drawText(ctx, it, px, py, k, 1);
    });
  },

  drawDownChevron(ctx, x, y) {
    ctx.fillStyle = "#181818";
    ctx.fillRect(x, y, 5, 1); ctx.fillRect(x + 1, y + 1, 3, 1); ctx.fillRect(x + 2, y + 2, 1, 1);
  },
};
