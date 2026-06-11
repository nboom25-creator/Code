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

> Requires an internet connection on first load — Three.js is pulled from a CDN
> via the import map in `index.html`.

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
| **Esc** | Game menu |

## Features

- Procedurally generated rolling-hills zone with trees, rocks, water, a hamlet
  and a central plaza.
- Procedural stylized humanoid models — each race built from its own proportions.
- Enemy AI: idle wandering, aggro, chase, melee attacks, leashing & respawns.
- Combat: cast bars, cooldowns, global cooldown, crits, slows, AoE, charges,
  projectiles with lighting, floating combat text.
- Progression: XP, leveling, scaling stats, a kill quest with a bonus objective.
- HUD: player/target unit frames, action bar, XP bar, live minimap, combat log.

## Project layout

```
index.html            # shell + screens + import map
styles.css            # all UI / HUD styling
src/
  data.js             # factions, races, classes, abilities
  characterModel.js   # procedural humanoid builder + animation
  world.js            # terrain, scenery, lighting, collision
  player.js           # stats, leveling, movement, resources
  enemies.js          # mob models, AI, spawning
  ui.js               # HUD, minimap, combat text, quests
  main.js             # bootstrap, char creation, game loop, combat
```

Built with Three.js. Original world, names, and lore.
