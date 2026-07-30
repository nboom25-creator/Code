// Generates the extension icons (a clothes hanger on a violet tile).
//
// Chrome wants real PNGs and this repo has no image toolchain, so we rasterise
// the glyph from signed-distance functions and encode the PNG by hand with
// node's built-in zlib. Run: node tools/make-icons.mjs
//
// Geometry is expressed in unit coordinates (0..1 across the tile) so a single
// description works at every size.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
const SIZES = [16, 32, 48, 128];
const SUBSAMPLES = 4; // per axis, so 16 samples per pixel

const GRAD_FROM = [0x7c, 0x5c, 0xff];
const GRAD_TO = [0xc1, 0x5c, 0xff];
const GLYPH = [0xff, 0xff, 0xff];

// ───────────────────────────── geometry ──────────────────────────────────

const APEX = [0.5, 0.44];
const BAR_Y = 0.665;
const BAR_LEFT = 0.215;
const BAR_RIGHT = 0.785;
const HOOK_CENTER = [0.555, 0.335];
const HOOK_R = 0.055;

/** Distance from point p to segment ab. */
function sdSegment(p, a, b) {
  const [px, py] = p;
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = px - a[0];
  const apy = py - a[1];
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  return Math.hypot(dx, dy);
}

/** The hanger hook, as a polyline sampled along a circular arc. */
const HOOK_POINTS = (() => {
  const points = [];
  const from = Math.PI; // leftmost point, where the stem meets it
  const to = -Math.PI / 3; // curls under on the right
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const theta = from + ((to - from) * i) / steps;
    points.push([
      HOOK_CENTER[0] + HOOK_R * Math.cos(theta),
      HOOK_CENTER[1] - HOOK_R * Math.sin(theta),
    ]);
  }
  return points;
})();

/** Shortest distance from p to the hanger outline. */
function hangerDistance(p) {
  let d = Math.min(
    sdSegment(p, APEX, [BAR_LEFT + 0.02, BAR_Y - 0.01]),
    sdSegment(p, APEX, [BAR_RIGHT - 0.02, BAR_Y - 0.01]),
    sdSegment(p, [BAR_LEFT, BAR_Y], [BAR_RIGHT, BAR_Y]),
    sdSegment(p, APEX, [0.5, HOOK_CENTER[1]]) // stem
  );
  for (let i = 1; i < HOOK_POINTS.length; i++) {
    d = Math.min(d, sdSegment(p, HOOK_POINTS[i - 1], HOOK_POINTS[i]));
  }
  return d;
}

/** Signed distance to a rounded square covering the tile (negative = inside). */
function roundedTileDistance(p, radius) {
  const qx = Math.abs(p[0] - 0.5) - (0.5 - radius);
  const qy = Math.abs(p[1] - 0.5) - (0.5 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

// ────────────────────────────── raster ───────────────────────────────────

function render(size) {
  // Keep the stroke legible at 16px without making it clumsy at 128px.
  const halfWidth = Math.max(0.03, 1.15 / size);
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SUBSAMPLES) / size;
          const v = (y + (sy + 0.5) / SUBSAMPLES) / size;
          if (roundedTileDistance([u, v], 0.22) > 0) continue;

          const t = (u + v) / 2;
          const inGlyph = hangerDistance([u, v]) < halfWidth;
          for (let c = 0; c < 3; c++) {
            const base = GRAD_FROM[c] + (GRAD_TO[c] - GRAD_FROM[c]) * t;
            const value = inGlyph ? GLYPH[c] : base;
            if (c === 0) r += value;
            else if (c === 1) g += value;
            else b += value;
          }
          a += 255;
        }
      }

      const total = SUBSAMPLES * SUBSAMPLES;
      const covered = a / 255; // how many subsamples landed inside the tile
      const i = (y * size + x) * 4;
      pixels[i] = covered ? Math.round(r / covered) : 0;
      pixels[i + 1] = covered ? Math.round(g / covered) : 0;
      pixels[i + 2] = covered ? Math.round(b / covered) : 0;
      pixels[i + 3] = Math.round(a / total);
    }
  }
  return pixels;
}

// ─────────────────────────── png encoding ────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode raw RGBA pixels as a PNG. Exported so tests can build fixtures. */
export function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ──────────────────────────────── main ───────────────────────────────────

// Only write files when run directly, so the encoder can be imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const file = join(OUT_DIR, `icon${size}.png`);
    writeFileSync(file, encodePng(size, size, render(size)));
    console.log(`wrote icons/icon${size}.png`);
  }
}
