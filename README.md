# WoW Mini-MMORPG Framework

A modular, 2D top-down mini-MMORPG framework inspired by **Classic World of
Warcraft** combat mechanics. The server runs an authoritative simulation built
on a small **Entity Component System (ECS)**; the browser client renders the
world on an HTML5 Canvas with a WoW-style HUD.

This is a foundation meant to be iterated on — networking, game logic and
rendering are split into distinct modules so new systems (spells, classes, mobs,
zones) can be layered in cleanly.

---

## Features implemented

### 1. ECS architecture (server)
- `World` — entity ids + a column store per component type, with `query()`.
- Core components: `Position`, `Stats` (HP/MaxHP/Mana/MaxMana), `Combat`
  (target, cast bar, GCD, swing timer, auto-attack), `ThreatTable`, plus
  `Identity`, `MoveIntent` and `MonsterAI`.

### 2. Classic WoW combat engine (server)
- **Global Cooldown** — a universal 1.5s cooldown triggered at cast start.
- **Targeting** — players target an entity; monsters target the highest entry
  on their `ThreatTable`.
- **Auto-attack loop** — a weapon swing every 2.0s while in combat and in melee
  range; out-of-range swings are held.
- **Cast bars** — timed casts track progress and are **cancelled by movement or
  by taking damage**.

### 3. Demo sandbox
- Spawns a **Target Dummy** at `(0, 50)`; each connecting client controls a
  **Player** spawned at `(0, 0)`.
- Two test abilities:
  - **Shadowbolt** — 2.0s cast, 10 mana, 20 Shadow damage, triggers GCD.
  - **Life Tap** — instant, costs 10 HP, restores 20 mana, triggers GCD.

### 4. Frontend visualization
- Canvas world with player/monster circles, nameplates and a selection ring.
- WoW-style **unit frames** (health/mana bars, nameplate, combat flag).
- Center **cast bar** with smooth interpolation.
- Bottom **action bar** with hotkeys and a Global Cooldown sweep.
- Scrolling **combat log** with school-colored text.

---

## Project structure

```
.
├── shared/                 # Wire protocol + tuning shared by both sides
│   └── src/
│       ├── protocol.ts     #   client<->server message types & snapshots
│       ├── spells.ts       #   spell definitions (data-driven)
│       └── constants.ts    #   GCD, swing timer, tick rate, ranges
│
├── server/                 # Authoritative Node.js + Express + ws backend
│   └── src/
│       ├── ecs/            #   World + components (data only)
│       ├── game/
│       │   ├── Game.ts     #   world ownership, spawns, snapshots, commands
│       │   ├── combat.ts   #   damage / threat / casting rules
│       │   ├── context.ts  #   per-tick context + combat-log sink
│       │   └── systems/    #   Movement, MonsterAI, Casting, AutoAttack, Regen
│       ├── net/            #   WebSocket transport
│       └── index.ts        #   entry point + demo sandbox
│
└── client/                 # Vite + vanilla TS + HTML5 Canvas frontend
    └── src/
        ├── net/            #   WebSocket connection
        ├── state/          #   client mirror of world state
        ├── render/         #   Renderer, UnitFrames, CastBar, ActionBar, CombatLog
        ├── input/          #   keyboard + mouse -> network commands
        └── main.ts         #   bootstrap + render loop
```

The architecture is **authoritative server, dumb client**: all combat rules run
server-side; the client only sends intents and renders snapshots.

---

## Getting started

```bash
npm install        # installs all three workspaces

npm run dev        # runs server (:3001) and client (:5173) together
```

Then open **http://localhost:5173**.

Run them separately if you prefer:

```bash
npm run dev:server   # tsx watch — http://localhost:3001
npm run dev:client   # vite      — http://localhost:5173
```

Type-check everything:

```bash
npm run typecheck
```

### Controls

| Input            | Action                          |
| ---------------- | ------------------------------- |
| `W A S D` / arrows | Move (cancels casting)        |
| `Tab` / click    | Target the dummy                |
| `Esc`            | Clear target                    |
| `1`              | Toggle Auto-Attack              |
| `2`              | Cast Shadowbolt (2.0s)          |
| `3`              | Cast Life Tap (instant)         |

---

## Extending it

- **New spells:** add an entry to `shared/src/spells.ts`; the cast/GCD/threat
  pipeline and the client tooltips pick it up automatically. Bind it to a new
  action-bar slot in `client/src/render/ActionBar.ts`.
- **New components/systems:** add a component in `server/src/ecs/components.ts`
  and a system in `server/src/game/systems/`, then register it in `Game.ts`.
- **New message types:** extend `ClientMessage` / `ServerMessage` in
  `shared/src/protocol.ts` — both sides share the definitions.
