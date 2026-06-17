/* ============================================================
   assets.js — load & parse sprite sheets / tilesets from files.

   Files live under:
     assets/sprites/      character & object sheets
     assets/tilesets/     map tilesets (16x16 grid)

   A "sprite sheet" is one image packed with equal-size frames laid
   out left-to-right, top-to-bottom. We slice it with simple math:
     col = index % columns
     row = floor(index / columns)
     sx  = col * frameW,  sy = row * frameH
   and blit the (sx,sy,frameW,frameH) source rect to the canvas.
   ============================================================ */

class SpriteSheet {
  constructor(image, frameW, frameH) {
    this.image = image;
    this.fw = frameW;
    this.fh = frameH;
    this.cols = Math.floor(image.width / frameW);
    this.rows = Math.floor(image.height / frameH);
    this.count = this.cols * this.rows;
  }
  // Blit the frame at grid position (col,row).
  draw(ctx, col, row, dx, dy, scale = 1) {
    ctx.drawImage(
      this.image,
      col * this.fw, row * this.fh, this.fw, this.fh,
      Math.round(dx), Math.round(dy), this.fw * scale, this.fh * scale
    );
  }
  // Blit by linear frame index (row-major).
  drawIndex(ctx, index, dx, dy, scale = 1) {
    this.draw(ctx, index % this.cols, Math.floor(index / this.cols), dx, dy, scale);
  }
}

// A tileset is just a sheet of 16x16 tiles addressed by linear index.
class Tileset extends SpriteSheet {
  drawTile(ctx, index, dx, dy) { this.drawIndex(ctx, index, dx, dy, 1); }
}

/* 4-directional, 3-frame walk cycle.
   Sheet layout (columns x rows):
     col 0 = LEFT-FOOT,  col 1 = NEUTRAL,  col 2 = RIGHT-FOOT
     row 0 = DOWN, row 1 = LEFT, row 2 = RIGHT, row 3 = UP
   The animation sequence is Left-Foot -> Neutral -> Right-Foot -> Neutral,
   advancing one entry per tile stepped (tracked by `foot`). */
class CharacterSprite {
  constructor(sheet) {
    this.sheet = sheet;
    this.dirRow = { down: 0, left: 1, right: 2, up: 3 };
    this.foot = 0; // toggled each step: 0 -> left foot, 1 -> right foot
  }
  // Which column to show: neutral when idle; mid-step shows the lifted foot.
  frameCol(moving, progress) {
    if (!moving) return 1;            // NEUTRAL
    return progress < 0.5 ? (this.foot ? 2 : 0) : 1; // foot then settle
  }
  draw(ctx, dir, moving, progress, dx, dy, scale = 1) {
    const row = this.dirRow[dir] ?? 0;
    this.sheet.draw(ctx, this.frameCol(moving, progress), row, dx, dy, scale);
  }
}

const Assets = {
  images: {},
  sheets: {},     // name -> SpriteSheet
  tilesets: {},   // name -> Tileset
  ready: false,
  error: null,

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load " + src));
      img.src = src;
    });
  },

  // Load everything the overworld needs, then parse into sheets/tilesets.
  async loadAll() {
    try {
      const [player, overworld] = await Promise.all([
        this.loadImage("assets/sprites/player.png"),
        this.loadImage("assets/tilesets/overworld.png"),
      ]);
      this.images.player = player;
      this.images.overworld = overworld;
      this.sheets.player = new SpriteSheet(player, 16, 16);   // 3 cols x 4 rows
      this.tilesets.overworld = new Tileset(overworld, 16, 16);
      this.ready = true;
    } catch (e) {
      this.error = e;
      console.error(e);
    }
  },
};
