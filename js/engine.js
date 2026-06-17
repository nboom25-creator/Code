/* ============================================================
   engine.js — overworld: tilemap, camera, movement, encounters.
   Talks to the global Game (main.js), UI (main.js) and Battle.
   ============================================================ */

const TILE = 16;                  // pixels per tile
const VIEW_W = 240, VIEW_H = 160; // GBA-native canvas size (15 x 10 tiles)

const SOLID = new Set(["T", "w", "h", "H", "M", "L", "G", "s", "r", "F"]);
const TALL  = "t";
const LEDGE = "=";

const Engine = {
  map: null, w: 0, h: 0,
  player: { x: 0, y: 0, dir: "down", ox: 0, oy: 0, moving: false, frame: 0, stepParity: 0 },
  held: null,         // currently held direction
  busy: false,        // suppress input while warping/animating special
  playerSprite: null, // CharacterSprite bound to the loaded player sheet
  _tileIndex: null,   // char -> tileset index

  init() {
    this.map = WORLD.rows;
    this.h = this.map.length;
    this.w = WORLD.width;
    this.player.x = WORLD.playerStart.x;
    this.player.y = WORLD.playerStart.y;
    this.player.dir = "down";
    this._tileIndex = {};
    this.TILE_LIST.forEach((ch, i) => { this._tileIndex[ch] = i; });
  },

  // Called once assets finish loading (from Game.init).
  bindAssets() {
    if (Assets.sheets.player) this.playerSprite = new CharacterSprite(Assets.sheets.player);
  },

  tileAt(x, y) {
    if (y < 0 || y >= this.h || x < 0 || x >= this.w) return "T";
    return this.map[y][x] || "T";
  },

  isSolid(x, y) { return SOLID.has(this.tileAt(x, y)); },

  /* ---- input from main.js ---- */
  onPress(input) {
    if (this.busy || this.player.moving) {
      if (["up","down","left","right"].includes(input)) this.held = input;
      return;
    }
    if (input === "a")    { this.interact(); return; }
    if (input === "start"){ Game.openPartyMenu(); return; }
    if (["up","down","left","right"].includes(input)) {
      this.held = input;
      this.tryMove(input);
    }
  },
  onRelease(input) {
    if (this.held === input) this.held = null;
  },

  dirDelta(dir) {
    return { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  },

  tryMove(dir) {
    this.player.dir = dir;
    const [dx, dy] = this.dirDelta(dir);
    const nx = this.player.x + dx, ny = this.player.y + dy;
    const target = this.tileAt(nx, ny);

    // Ledge: only hoppable downward; jumps two tiles.
    if (target === LEDGE && dir === "down") {
      const lx = nx, ly = ny + 1;
      if (!this.isSolid(lx, ly)) { this.startMove(dir, 2); return; }
    }
    if (target === LEDGE) return; // can't pass otherwise

    if (this.isSolid(nx, ny)) {
      // Bumping a door? doors are walkable so handled below. Signs are solid+interact.
      return;
    }
    this.startMove(dir, 1);
  },

  startMove(dir, dist) {
    const [dx, dy] = this.dirDelta(dir);
    this.player.moving = true;
    this.player.tox = this.player.x + dx * dist;
    this.player.toy = this.player.y + dy * dist;
    this.player.ox = 0; this.player.oy = 0;
    this.player.moveT = 0;
    this.player.moveDur = dist > 1 ? 16 : 11; // frames
    this.player.moveDX = dx * dist;
    this.player.moveDY = dy * dist;
  },

  finishMove() {
    const p = this.player;
    p.x = p.tox; p.y = p.toy;
    p.ox = 0; p.oy = 0; p.moving = false;
    p.stepParity ^= 1; // alternate left-foot / right-foot each step

    // Door / warp?
    const key = p.x + "," + p.y;
    if (WORLD.doors[key]) { Game.useDoor(WORLD.doors[key]); return; }

    // Wild encounter in tall grass.
    if (this.tileAt(p.x, p.y) === TALL) {
      if (Math.random() < 0.22) { Game.triggerEncounter(p.x, p.y); return; }
    }

    // Continue walking if button still held.
    if (this.held && !this.busy) this.tryMove(this.held);
  },

  interact() {
    const [dx, dy] = this.dirDelta(this.player.dir);
    const fx = this.player.x + dx, fy = this.player.y + dy;
    const key = fx + "," + fy;
    if (WORLD.signs[key]) { Game.readSign(WORLD.signs[key]); return; }
    if (WORLD.doors[key]) { Game.useDoor(WORLD.doors[key]); return; }
  },

  update() {
    const p = this.player;
    if (p.moving) {
      p.moveT++;
      const t = Math.min(1, p.moveT / p.moveDur);
      p.ox = p.moveDX * t * TILE;
      p.oy = p.moveDY * t * TILE;
      // little hop arc on ledge jumps
      if (Math.abs(p.moveDY) > 1) p.hop = Math.sin(t * Math.PI) * 8; else p.hop = 0;
      if (p.moveT >= p.moveDur) this.finishMove();
    }
  },

  /* ---- rendering ---- */
  render(ctx) {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    const p = this.player;
    // Camera centers player; pixel offset for smoothness.
    const camPX = (p.x * TILE + p.ox) - VIEW_W / 2 + TILE / 2;
    const camPY = (p.y * TILE + p.oy) - VIEW_H / 2 + TILE / 2;

    const startTX = Math.floor(camPX / TILE) - 1;
    const startTY = Math.floor(camPY / TILE) - 1;
    const cols = Math.ceil(VIEW_W / TILE) + 2;
    const rows = Math.ceil(VIEW_H / TILE) + 2;

    for (let ty = startTY; ty < startTY + rows; ty++) {
      for (let tx = startTX; tx < startTX + cols; tx++) {
        const sx = Math.round(tx * TILE - camPX);
        const sy = Math.round(ty * TILE - camPY);
        this.drawTile(ctx, this.tileAt(tx, ty), sx, sy);
      }
    }

    // Player at screen center.
    const psx = Math.round(p.x * TILE + p.ox - camPX);
    const psy = Math.round(p.y * TILE + p.oy - camPY) - (p.hop || 0);
    // 16x16 character frame from the loaded sheet, drawn ~4px high so the
    // feet sit on the tile (classic overworld framing).
    if (this.playerSprite) {
      const progress = p.moving ? (p.moveT / p.moveDur) : 0;
      this.playerSprite.foot = p.stepParity;
      this.playerSprite.draw(ctx, p.dir, p.moving, progress, psx, psy - 4);
    }
  },

  // Tile draw order -> index in the baked tileset (assets/tilesets/overworld.png).
  // This array is the single source of truth shared with scripts/build_assets.js.
  TILE_LIST: [".", "p", "t", "T", "w", "h", "H", "M", "G", "L", "d", "s", "="],

  // Runtime tile draw: blit the 16x16 cell from the loaded tileset.
  drawTile(ctx, ch, x, y) {
    const ts = Assets.tilesets.overworld;
    const idx = this._tileIndex ? this._tileIndex[ch] : undefined;
    if (ts && idx !== undefined) { ts.drawTile(ctx, idx, x, y); return; }
    this.procTile(ctx, ch, x, y); // fallback (also the art baked into the sheet)
  },

  // Build-time art source: each case paints one 16x16 tile. The build script
  // (scripts/build_assets.js) renders these into assets/tilesets/overworld.png.
  procTile(ctx, ch, x, y) {
    switch (ch) {
      case ".": // grass
        ctx.fillStyle = "#78c850"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#68b840";
        ctx.fillRect(x+3, y+10, 2, 2); ctx.fillRect(x+11, y+4, 2, 2);
        break;
      case "p": // path
        ctx.fillStyle = "#d8c8a0"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#c8b888"; ctx.fillRect(x, y, TILE, 2);
        break;
      case "t": // tall grass
        ctx.fillStyle = "#78c850"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#3a8a38";
        for (let i = 0; i < 4; i++) { ctx.fillRect(x+2+i*4, y+8, 2, 6); }
        ctx.fillStyle = "#58a038";
        for (let i = 0; i < 3; i++) { ctx.fillRect(x+4+i*4, y+4, 2, 5); }
        break;
      case "T": // tree
        ctx.fillStyle = "#78c850"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#2a6a28"; ctx.fillRect(x+1, y+1, 14, 12);
        ctx.fillStyle = "#3a8a38"; ctx.fillRect(x+3, y+2, 10, 8);
        ctx.fillStyle = "#7a4a20"; ctx.fillRect(x+6, y+12, 4, 4);
        break;
      case "w": // water
        ctx.fillStyle = "#4878d0"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#a0e8f0"; ctx.fillRect(x+2, y+5, 5, 1); ctx.fillRect(x+9, y+10, 4, 1);
        break;
      case "h": // house wall
        ctx.fillStyle = "#b8704a"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#9a5a38"; ctx.fillRect(x, y+7, TILE, 1); ctx.fillRect(x+7, y, 1, TILE);
        break;
      case "H": // Pokémon Center roof marker
        ctx.fillStyle = "#e0392b"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#fff"; ctx.fillRect(x+6, y+3, 4, 10); ctx.fillRect(x+3, y+6, 10, 4);
        break;
      case "M": // Mart roof marker (fillRect only, so it bakes cleanly)
        ctx.fillStyle = "#3068c0"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#2050a0"; ctx.fillRect(x, y+8, TILE, 1); ctx.fillRect(x+7, y, 1, TILE);
        ctx.fillStyle = "#f8d030"; ctx.fillRect(x+4, y+4, 2, 7); ctx.fillRect(x+10, y+4, 2, 7);
        ctx.fillRect(x+4, y+4, 8, 2); ctx.fillRect(x+4, y+7, 6, 2);
        break;
      case "G": // gym roof marker
        ctx.fillStyle = "#586870"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#3a474d"; ctx.fillRect(x, y+8, TILE, 1); ctx.fillRect(x+7, y, 1, TILE);
        ctx.fillStyle = "#c0c8cc"; ctx.fillRect(x+5, y+4, 6, 3);
        break;
      case "L": // lab interior wall
        ctx.fillStyle = "#8890a0"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#707888"; ctx.fillRect(x, y+8, TILE, 1);
        break;
      case "d": // door
        ctx.fillStyle = "#78c850"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#5a3a1a"; ctx.fillRect(x+3, y+2, 10, 14);
        ctx.fillStyle = "#caa060"; ctx.fillRect(x+5, y+5, 6, 9);
        ctx.fillStyle = "#5a3a1a"; ctx.fillRect(x+9, y+9, 1, 2);
        break;
      case "s": // sign
        ctx.fillStyle = "#78c850"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#7a4a20"; ctx.fillRect(x+3, y+3, 10, 7);
        ctx.fillStyle = "#5a3414"; ctx.fillRect(x+7, y+10, 2, 5);
        ctx.fillStyle = "#caa060"; ctx.fillRect(x+4, y+4, 8, 2);
        break;
      case "=": // ledge
        ctx.fillStyle = "#78c850"; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#c8b888"; ctx.fillRect(x, y, TILE, 6);
        ctx.fillStyle = "#9a8a60"; ctx.fillRect(x, y+5, TILE, 2);
        ctx.fillStyle = "#8a7a50"; for (let i=0;i<TILE;i+=4) ctx.fillRect(x+i, y+7, 2, 2);
        break;
      default:
        ctx.fillStyle = "#78c850"; ctx.fillRect(x, y, TILE, TILE);
    }
  },
};
