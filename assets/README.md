# Assets

The engine loads and slices image files from here at runtime (`js/assets.js`).
All art is laid out on a **strict 16×16 pixel grid**.

```
assets/
  sprites/
    player.png      character sheet — 3 columns × 4 rows of 16×16 frames (48×64)
  tilesets/
    overworld.png   map tiles — a row of 16×16 tiles (one cell per tile type)
```

## Sprite sheets (`SpriteSheet`)

A sheet is one image packed with equal-size frames, left-to-right then
top-to-bottom. Frames are addressed by `(col, row)` or a linear `index`:

```
col = index % columns          sx = col * frameW
row = floor(index / columns)   sy = row * frameH
drawImage(img, sx, sy, frameW, frameH, dx, dy, frameW*scale, frameH*scale)
```

### `player.png` — 4-directional, 3-frame walk

| row | direction | col 0 | col 1   | col 2  |
|-----|-----------|-------|---------|--------|
| 0   | DOWN      | left-foot | neutral | right-foot |
| 1   | LEFT      | left-foot | neutral | right-foot |
| 2   | RIGHT     | left-foot | neutral | right-foot |
| 3   | UP        | left-foot | neutral | right-foot |

The walk cycle is **Left-Foot → Neutral → Right-Foot → Neutral**, advancing one
entry per tile stepped. Idle shows the NEUTRAL frame.

## Tilesets (`Tileset`)

`overworld.png` is a strip of 16×16 tiles. Each map character maps to a tile
index via `Engine.TILE_LIST` (the canonical order, shared with the baker):

```
index: 0=grass 1=path 2=tall-grass 3=tree 4=water 5=house
       6=Center 7=Mart 8=Gym 9=lab 10=door 11=sign 12=ledge
```

## Regenerating the bundled art

The shipped PNGs are **original** art (not from any commercial game) baked by:

```
node scripts/build_assets.js
```

The tileset is rendered from `Engine.procTile`, so the engine's tile art and the
baked sheet never drift apart. To use your own art, replace these PNGs (keeping
the same grid layout) — no code changes needed.
