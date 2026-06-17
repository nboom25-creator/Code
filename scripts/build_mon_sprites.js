/* ============================================================
   build_mon_sprites.js — bake ORIGINAL Pokémon pixel art into
   64x64 transparent PNGs the battle scene loads from
   /assets/sprites/<species>_front.png and _back.png.

   Run:  node scripts/build_mon_sprites.js

   These are placeholders generated from the in-repo pixel grids
   (sprites.js) with a clean dark outline added. Replace any file
   with your own 64x64 art and the loader picks it up automatically.
   ============================================================ */

const fs = require("fs"), zlib = require("zlib"), path = require("path");

/* ---- tiny RGBA PNG encoder ---- */
let CRC = []; for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c>>>1) : c>>>1; CRC[n] = c>>>0; }
function crc32(b){ let c = 0xffffffff; for (let i=0;i<b.length;i++) c = CRC[(c^b[i])&0xff]^(c>>>8); return (c^0xffffffff)>>>0; }
function chunk(type, data){ const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function encodePNG(buf, W, H){
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++){ raw[y*(1+W*4)] = 0; for (let x = 0; x < W*4; x++) raw[y*(1+W*4)+1+x] = buf[y*W*4+x]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function hex(c){ let h = c.slice(1); if (h.length===3) h = h.split("").map(x=>x+x).join("");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }

/* ---- load the art tables (PAL, MON_SPRITES, MON_BACK, helpers) ---- */
global.window = { addEventListener(){} }; global.navigator = {};
global.document = { getElementById(){ return { getContext(){ return {}; }, style:{}, addEventListener(){} }; }, querySelectorAll(){ return []; }, addEventListener(){} };
global.localStorage = { getItem(){ return null; }, setItem(){} }; global.requestAnimationFrame = ()=>{};
const files = ["js/data.js","js/sprites.js"];
const code = files.map(f => fs.readFileSync(path.join(__dirname,"..",f),"utf8")).join("\n");
(0, eval)(code + "\nglobalThis.__X = { DEX, PAL, MON_SPRITES, MON_BACK, monSprite, monBackSprite };");
const { DEX, PAL, MON_SPRITES, MON_BACK, monSprite, monBackSprite } = globalThis.__X;

const SIZE = 64, OUTLINE = "#202020";

function bake(grid) {
  const buf = new Uint8Array(SIZE * SIZE * 4); // transparent
  const maxLen = Math.max(...grid.map(r => r.length));
  const gh = grid.length;
  const scale = Math.max(1, Math.floor((SIZE - 4) / Math.max(maxLen, gh)));
  const ox = Math.floor((SIZE - maxLen * scale) / 2);
  const oy = SIZE - gh * scale - 2; // feet near the bottom
  const filled = (r, c) => grid[r] && grid[r][c] && PAL[grid[r][c]];
  const put = (x, y, rgb) => { for (let yy=0; yy<scale; yy++) for (let xx=0; xx<scale; xx++) {
    const px = x+xx, py = y+yy; if (px<0||py<0||px>=SIZE||py>=SIZE) continue;
    const i = (py*SIZE+px)*4; buf[i]=rgb[0]; buf[i+1]=rgb[1]; buf[i+2]=rgb[2]; buf[i+3]=255; }; };

  // 1) outline pass: dilate the silhouette in dark
  const ol = hex(OUTLINE);
  for (let r=0;r<gh;r++) for (let c=0;c<grid[r].length;c++) if (filled(r,c))
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++)
      put(ox+(c+dx)*scale, oy+(r+dy)*scale, ol);
  // 2) colour pass: real palette pixels on top
  for (let r=0;r<gh;r++) for (let c=0;c<grid[r].length;c++) if (filled(r,c))
    put(ox+c*scale, oy+r*scale, hex(PAL[grid[r][c]]));

  return encodePNG(buf, SIZE, SIZE);
}

const outDir = path.join(__dirname, "..", "assets", "sprites");
fs.mkdirSync(outDir, { recursive: true });
let nf = 0, nb = 0;
for (const species of Object.keys(DEX)) {
  fs.writeFileSync(path.join(outDir, species + "_front.png"), bake(monSprite(species))); nf++;
  if (MON_BACK[species]) { fs.writeFileSync(path.join(outDir, species + "_back.png"), bake(MON_BACK[species])); nb++; }
}
console.log(`wrote ${nf} *_front.png and ${nb} *_back.png (64x64) to assets/sprites/`);
