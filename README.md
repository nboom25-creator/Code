# Realms of Azora ⚔️

A **World of Warcraft–style 3D MMORPG**, playable right in your browser. Built
from scratch with [Three.js](https://threejs.org/) — stylized low-poly graphics,
two warring factions, **12 playable races**, six classes, real-time combat,
leveling, quests, a minimap, and a full WoW-flavored UI.

![style](https://img.shields.io/badge/style-WoW%20inspired-d4af37)

## Play it

The game uses ES modules + an import map, so it must be served over HTTP (not
opened as a `file://`). Any static server works:

```bash
# option 1 — Node (no install needed)
npm start            # serves on http://localhost:8080

# option 2 — Python
python3 -m http.server 8080
```

Then open **http://localhost:8080** in a modern browser (Chrome/Edge/Firefox).

> **Runs fully offline.** Three.js is vendored locally in `vendor/` — no CDN or
> internet connection required.

## Play on your phone 📱

**Option A — GitHub Pages (a public URL).** The game is fully static, so the
simplest host is Pages' *branch* mode:

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **"Deploy from a branch"**
   (this is the one with a **Save** button — "GitHub Actions" mode has no Save).
3. Pick branch **`claude/wow-style-game-build-u792fs`** and folder **`/docs`**,
   then click **Save**.
4. Wait ~1 minute; your game is live at
   `https://nboom25-creator.github.io/<repo>/` — open that on your phone.

(A `.nojekyll` file is included so Pages serves the files as-is. There's also an
optional Actions workflow if you prefer the "GitHub Actions" source — run it
manually from the Actions tab.)

**Option B — same Wi-Fi.** Run `npm start` on your computer, find its local IP
(e.g. `192.168.1.42`), and open `http://192.168.1.42:8080` on your phone while
both are on the same network.

The game **auto-detects touch devices** and shows on-screen controls:

| Touch | Action |
|---|---|
| **Left joystick** | Move (analog) |
| **Drag the screen** | Rotate camera |
| **Pinch** | Zoom |
| **Tap a creature** | Select target |
| **🎯 button** | Cycle target |
| **⤒ button** | Jump |
| **Action-bar icons** | Use abilities |
| **🗺️ / 🧍 / 🎒 buttons** | Map / Character / Bags |

On phones it also drops shadows, caps resolution, and thins out foliage to keep
the framerate smooth.

## Factions & Races

Pick a side, then choose your people. Each race has its own look (skin, build,
ears, height), lore, and racial traits.

| ⚜ The Covenant (good) | ⚔ The Dominion (bad) |
|---|---|
| **Human** — versatile kingdom-folk | **Grok'mar** — proud orcish warriors |
| **Stoneborn** — hardy dwarf smiths | **Forsaken** — the risen undead |
| **Sylvani** — moonlit night-elves | **Korhada** — towering tauren |
| **Tinker** — gnome inventors | **Zandari** — jungle troll mystics |
| **Lightborn** — exiled draenei | **Sunsworn** — arcane high elves |
| **Wildkin** — cursed worgen | **Sapper** — explosive goblins |

## Classes

Warrior ⚔️ · Paladin 🔨 · Hunter 🏹 · Rogue 🗡️ · Mage 🔮 · Priest ✚ — each with
its own resource (rage / mana / energy) and a 4-ability action bar.

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move (camera-relative) |
| **Mouse** (hold left/right button) | Rotate camera |
| **Mouse wheel** | Zoom |
| **Left-click** an enemy | Select target |
| **Tab** | Cycle to nearest enemy |
| **1 – 6** | Use action-bar abilities |
| **Space** | Jump |
| **B** | Toggle bags / inventory |
| **C** | Toggle character & stats panel |
| **M** | Toggle the world map |
| **Esc** | Game menu |

## The world map

Azora is **one seamless continent** — a 4×4 grid of **16 unique regions**
(~1920×1920 units, roughly 16× the original world) that streams in around you as
you explore, so it stays smooth no matter how far you roam. Open the **world map
(M)** to see them all and your position. Each region has its own biome, terrain,
palette, level range, and **its own creatures**:

| Region | Biome | Lv | Signature creatures |
|---|---|---|---|
| Whisperwood ⌂ | forest (start) | 1–6 | Ridgeback Boar, Gray Stalker, Treant |
| Goldmeadow Plains | grassland | 3–8 | Plains Lion, Swift Raptor, Highway Bandit |
| Wildgrove | autumn forest | 5–10 | Elder Stag, Dire Wolf, Grizzly |
| Mistral Coast | beach | 6–11 | Tidal Crab, Reef Crawler, Coastal Siren |
| Thornmarsh | swamp | 8–13 | Bog Lurker, Crocolisk, Will-o'-Wisp |
| Stormpeak Highlands | rocky hills | 10–15 | Crag Boar, Wild Gryphon, Storm Elemental |
| Verdant Jungle | jungle | 12–17 | Shadow Panther, Venom Serpent, Headhunter |
| Ashen Badlands | badlands | 14–19 | Boulder Golem, Carrion Vulture, Marauder |
| Frostspire Peaks | snow mountains | 15–20 | Frostfang Wolf, Frost Yeti, Ice Elemental |
| Shadowmoor ⚑ | cursed forest | 18–24 | Shadow Stalker, Ghoul, Wraith |
| Bloodfen | red swamp | 20–26 | Bloodleech, Bog Troll, Plague Rat |
| Sunscorch Desert | dunes | 22–28 | Sand Wurm, Plague Scarab, Dust Raider |
| Crystalvale | crystal fields | 24–30 | Mana Wyrm, Crystal Golem, Arcane Sprite |
| Emberfall Wastes | volcanic | 28–34 | Lava Hound, Magma Elemental, Scorchling |
| Direhollow | haunted | 32–40 | Risen Skeleton, Banshee, Dire Bat |
| The Maw | corrupted (endgame) | 45–55 | Fel Hound, Pit Demon, Dreadlord |

⚑ **Shadowmoor** holds a portal into **Shadowfang Crypt** — an instanced,
torch-lit dungeon of skeletons and wraiths leading to the boss **Lord Mortis**,
who drops guaranteed epic loot. Step back through the portal to return to the
exact spot you left.

## Loot & gear

- Enemies drop **procedurally generated items** across 6 rarities
  (poor → legendary), each with random stats scaled to the mob's level.
- Open your **bags (B)** and click an item to equip it; open the
  **character panel (C)** to see equipped gear and your totals.
- Gear actually matters: **Stamina** boosts health, **Intellect** boosts mana,
  **Attack/Spell Power** boost damage, **Crit** boosts crit chance, and **Armor**
  reduces incoming damage. Hover any item for a full tooltip.

## Features

- **WoW-scale streamed continent**: 16 unique biome regions on one seamless map
  with terrain chunk streaming (only ~9 cells active at a time) and a sun that
  follows you for crisp local shadows.
- **~48 unique creatures** built from 7 procedural body types (quadruped, biped,
  serpent, flyer, ooze, golem, insect), themed per region.
- Instanced **Shadowfang Crypt** dungeon with a boss, reached by portal.
- Procedural stylized character models — each race built from its own proportions.
- Enemy AI: idle wandering, aggro, chase, melee attacks, leashing; flyers, oozes,
  golems, and a high-health boss.
- Combat: cast bars, cooldowns, global cooldown, crits, slows, AoE, charges,
  projectiles with lighting, floating combat text, armor mitigation.
- Full loot & equipment system with 6 rarities, tooltips and live stat updates.
- Progression: XP, leveling, scaling stats, a kill quest with a bonus objective.
- HUD: player/target unit frames, action bar, XP bar, live minimap, world map,
  combat log, inventory and character panels.

## Project layout

```
docs/                   # the playable site (served by GitHub Pages /docs)
  index.html            # shell + screens + import map
  styles.css            # all UI / HUD styling
  vendor/three.module.js# bundled Three.js (offline)
  src/
  data.js             # factions, races, classes, abilities
  items.js            # item rarities, procedural loot, drop tables
  regions.js          # 16-region world grid + global terrain samplers
  creatures.js        # creature body builders + ~48-creature registry
  zones.js            # instanced zone definitions (the crypt dungeon)
  characterModel.js   # procedural humanoid builder + animation
  world.js            # Overworld streamer + dungeon Zone builder
  player.js           # stats, leveling, movement, inventory & gear
  enemies.js          # creature instances, AI, chunk streaming, boss
  ui.js               # HUD, minimap, world map, panels, combat text
  main.js             # bootstrap, char creation, loop, combat, travel
  touch.js            # on-screen joystick + buttons for phones
```

Built with Three.js. Original world, names, and lore.
