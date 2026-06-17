/* ============================================================
   build_assets.js — bakes ORIGINAL pixel art into sprite-sheet
   PNGs that the runtime loads from /assets/ and slices.

   Run:  node scripts/build_assets.js
   Outputs:
     assets/tilesets/overworld.png  (16x16 tiles, order = Engine.TILE_LIST)
     assets/sprites/player.png      (3 cols x 4 rows of 16x16 walk frames)

   The tileset is rendered from Engine.procTile (the in-engine tile art),
   so engine art and the baked sheet never drift apart.
   ============================================================ */

const fs = require("fs"), zlib = require("zlib"), path = require("path");

/* ---- tiny RGBA PNG encoder ---- */
let CRC = []; for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c>>>1) : c>>>1; CRC[n] = c>>>0; }
function crc32(b){ let c = 0xffffffff; for (let i=0;i<b.length;i++) c = CRC[(c^b[i])&0xff]^(c>>>8); return (c^0xffffffff)>>>0; }
function chunk(type, data){ const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function encodePNG(buf, W, H){ // buf = RGBA Uint8Array
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++){ raw[y*(1+W*4)] = 0; for (let x = 0; x < W*4; x++) raw[y*(1+W*4)+1+x] = buf[y*W*4+x]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=6; // RGBA
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function parseColor(c){
  if (c[0] === "#"){ let h = c.slice(1); if (h.length===3) h = h.split("").map(x=>x+x).join("");
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 255]; }
  return [0,0,0,255];
}

/* ---- minimal fillRect canvas writing into an RGBA buffer ---- */
function makeBufCtx(buf, W, H){
  let fill = [0,0,0,255];
  return {
    set fillStyle(c){ fill = parseColor(c); }, get fillStyle(){ return ""; },
    set font(v){}, set strokeStyle(v){}, set lineWidth(v){},
    fillRect(x,y,w,h){ x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
      for (let yy=0;yy<h;yy++) for (let xx=0;xx<w;xx++){ const px=x+xx, py=y+yy;
        if (px<0||py<0||px>=W||py>=H) continue; const i=(py*W+px)*4;
        buf[i]=fill[0]; buf[i+1]=fill[1]; buf[i+2]=fill[2]; buf[i+3]=255; } },
    fillText(){}, beginPath(){}, arc(){}, ellipse(){}, fill(){}, stroke(){},
    save(){}, restore(){}, translate(){}, rotate(){},
  };
}

/* ---- load engine art (Engine.procTile + Engine.TILE_LIST) ---- */
global.window = { addEventListener(){} }; global.navigator = {};
global.document = { getElementById(){ return { getContext(){ return {}; }, style:{}, addEventListener(){} }; }, querySelectorAll(){ return []; }, addEventListener(){} };
global.localStorage = { getItem(){ return null; }, setItem(){} }; global.requestAnimationFrame = ()=>{};
global.Image = class {}; // assets.js references Image at class-eval time only via methods
const files = ["js/data.js","js/sprites.js","js/font.js","js/assets.js","js/engine.js"];
const code = files.map(f => fs.readFileSync(path.join(__dirname,"..",f),"utf8")).join("\n");
(0, eval)(code + "\nglobalThis.__Engine = Engine;");
const Engine = globalThis.__Engine;

/* ---- bake tileset ---- */
function bakeTileset(){
  const tiles = Engine.TILE_LIST, W = tiles.length * 16, H = 16;
  const buf = new Uint8Array(W * H * 4); // transparent
  const ctx = makeBufCtx(buf, W, H);
  tiles.forEach((ch, i) => Engine.procTile(ctx, ch, i * 16, 0));
  const out = path.join(__dirname, "..", "assets", "tilesets", "overworld.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePNG(buf, W, H));
  console.log("wrote", out, `(${W}x${H}, ${tiles.length} tiles: ${tiles.join(" ")})`);
}

/* ---- character walk frames (original art) ----
   Palette: K outline, R cap, S skin, B shirt, b pants, N hair, W eye. */
const CPAL = { ".":null, K:"#202020", R:"#e0392b", S:"#f0c89a", B:"#3a64c8", b:"#243f7a", N:"#6a4a30", W:"#f8f8f8" };
function mirror(grid){ return grid.map(r => r.split("").reverse().join("")); }
function drawCharFrame(buf, W, grid, ox, oy){
  for (let r=0;r<grid.length;r++) for (let c=0;c<grid[r].length;c++){
    const col = CPAL[grid[r][c]]; if (!col) continue; const rgb = parseColor(col);
    const px = ox+c, py = oy+r, i = (py*W+px)*4;
    buf[i]=rgb[0]; buf[i+1]=rgb[1]; buf[i+2]=rgb[2]; buf[i+3]=255;
  }
}

// DOWN: [leftFoot, neutral, rightFoot]
const DOWN = {
  neutral: [
    "................","....RRRRRR......","...RRRRRRRR.....","...RRRRRRRR.....",
    "...SSSSSSSS.....","...SKSSSSKS.....","...SSSSSSSS.....","....SSSSSS......",
    "...BBBBBBBB.....","..BBBBBBBBBB....","..SBBBBBBBBS....","...BBBBBBBB.....",
    "...bbbBBbbb.....","...bbb..bbb.....","...bbb..bbb.....","...KK....KK.....",
  ],
};
DOWN.left = DOWN.neutral.slice(0,12).concat([
  "...bbbBBbbb.....","..bbb...bbb.....","..bbb....bb.....","..KK.....KK.....",
]);
DOWN.right = DOWN.neutral.slice(0,12).concat([
  "...bbbBBbbb.....","...bbb...bbb....","...bb....bbb....","...KK....KKK....",
]);

// UP: back of head (hair), no eyes.
const UP = {
  neutral: [
    "................","....RRRRRR......","...RRRRRRRR.....","...RRRRRRRR.....",
    "...NNNNNNNN.....","...NNNNNNNN.....","...NNNNNNNN.....","....NNNNNN......",
    "...BBBBBBBB.....","..BBBBBBBBBB....","..bBBBBBBBBb....","...BBBBBBBB.....",
    "...bbbBBbbb.....","...bbb..bbb.....","...bbb..bbb.....","...KK....KK.....",
  ],
};
UP.left  = UP.neutral.slice(0,12).concat(DOWN.left.slice(12));
UP.right = UP.neutral.slice(0,12).concat(DOWN.right.slice(12));

// RIGHT profile. (LEFT is the horizontal mirror.)
const RIGHT = {
  neutral: [
    "................","....RRRRRR......","...RRRRRRRR.....","....SSSSSSR.....",
    "....SSSSSSS.....","....SSSSKSS.....","....SSSSSSS.....",".....SSSSS......",
    "....BBBBBB......","...BBBBBBBB.....","...BBBBBBBBS....","....BBBBBB......",
    "....bbbbbb......","....bb.bbb......","....bb..bb......","....KK..KK......",
  ],
};
RIGHT.left = RIGHT.neutral.slice(0,12).concat([
  "....bbbbbb......","...bbbbb........","...bb..bb.......","...KK..KK.......",
]);
RIGHT.right = RIGHT.neutral.slice(0,12).concat([
  "....bbbbbb......",".....bbbbb......",".....bb.bb......",".....KK.KK......",
]);
const LEFT = { neutral: mirror(RIGHT.neutral), left: mirror(RIGHT.left), right: mirror(RIGHT.right) };

function bakePlayer(){
  const W = 48, H = 64; // 3 cols x 4 rows of 16x16
  const buf = new Uint8Array(W * H * 4);
  const rows = [DOWN, LEFT, RIGHT, UP];      // row order = CharacterSprite.dirRow
  const cols = ["left", "neutral", "right"]; // col order = walk frames
  rows.forEach((dir, r) => cols.forEach((key, c) => drawCharFrame(buf, W, dir[key], c*16, r*16)));
  const out = path.join(__dirname, "..", "assets", "sprites", "player.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePNG(buf, W, H));
  console.log("wrote", out, `(${W}x${H}, 3 frames x 4 directions)`);
}

bakeTileset();
bakePlayer();
console.log("done.");
