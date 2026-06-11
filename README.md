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
| **Esc** | Game menu |

## Zones & the dungeon

Step into a glowing **portal** to travel between areas:

1. **Northshire Vale** — the green starter zone (levels 1–12) with a hamlet.
2. **Emberfall Wastes** — a harsh red wasteland (levels 8–18), dead trees & ogres.
3. **Shadowfang Crypt** — an instanced dungeon: a torch-lit hall of skeletons and
   wraiths leading to the boss, **Lord Mortis**, who drops guaranteed epic loot.

## Loot & gear

- Enemies drop **procedurally generated items** across 6 rarities
  (poor → legendary), each with random stats scaled to the mob's level.
- Open your **bags (B)** and click an item to equip it; open the
  **character panel (C)** to see equipped gear and your totals.
- Gear actually matters: **Stamina** boosts health, **Intellect** boosts mana,
  **Attack/Spell Power** boost damage, **Crit** boosts crit chance, and **Armor**
  reduces incoming damage. Hover any item for a full tooltip.

## Features

- Three hand-built zones (two open-world + one instanced dungeon) with portal
  travel and smooth fade transitions.
- Procedurally generated terrain, scenery, a hamlet, and a torch-lit crypt.
- Procedural stylized humanoid models — each race built from its own proportions.
- Enemy AI: idle wandering, aggro, chase, melee attacks, leashing & respawns;
  flying wraiths and a high-health boss.
- Combat: cast bars, cooldowns, global cooldown, crits, slows, AoE, charges,
  projectiles with lighting, floating combat text, armor mitigation.
- Full loot & equipment system with rarities, tooltips and live stat updates.
- Progression: XP, leveling, scaling stats, a kill quest with a bonus objective.
- HUD: player/target unit frames, action bar, XP bar, live minimap, combat log,
  inventory and character panels.

## Project layout

```
index.html            # shell + screens + import map
styles.css            # all UI / HUD styling
vendor/three.module.js# bundled Three.js (offline)
src/
  data.js             # factions, races, classes, abilities
  items.js            # item rarities, procedural loot, drop tables
  zones.js            # zone definitions (vale, wastes, crypt)
  characterModel.js   # procedural humanoid builder + animation
  world.js            # Zone builder: terrain/dungeon, scenery, portals
  player.js           # stats, leveling, movement, inventory & gear
  enemies.js          # mob models, AI, spawning, boss
  ui.js               # HUD, minimap, panels, combat text, quests
  main.js             # bootstrap, char creation, loop, combat, zones
```

Built with Three.js. Original world, names, and lore.
