# Pokémon Red — Mobile

A fan-made, mobile-first recreation of the classic Pokémon Red experience that
runs entirely in your phone's web browser. No installs, no servers, no build
step — it's plain HTML/CSS/JavaScript.

> This is an original, educational tribute. It is **not** affiliated with or
> endorsed by Nintendo / Game Freak / The Pokémon Company. No original game
> assets are used — all sprites and maps here are hand-drawn in code.

## Features

- 🕹️ **Touch controls** — on-screen D-pad + A/B/Start buttons sized for thumbs.
- 🗺️ **Overworld** — walk around Pallet Town & Route 1, smooth grid movement,
  trees/water/signs/ledges you can hop down.
- 🌱 **Wild encounters** — step into tall grass to find wild Pokémon.
- ⚔️ **Turn-based battles** — Gen-1-style damage, STAB, a full type chart,
  critical hits, PP, stat-lowering moves, and speed-ordered turns.
- 🔴 **Catching** — weaken a Pokémon and throw a Poké/Great/Ultra Ball (with the
  classic 3-shake animation).
- 📈 **Leveling & evolution** — gain EXP, learn moves, and evolve
  (e.g. Charmander → Charmeleon → Charizard).
- 🏥 **Town buildings** — heal at the Pokémon Center, restock at the Mart, and
  pick your starter at Prof. Oak's Lab.
- 💾 **Auto-save** — progress is stored in your browser (localStorage); pick
  *Continue* on the title screen.

## How to play on your phone

**Option A — GitHub Pages (recommended, gives you a real link):**

1. Push this repo to GitHub.
2. In the repo: **Settings → Pages → Build and deployment**.
3. Set **Source** to *Deploy from a branch*, branch `main` (or this feature
   branch), folder `/ (root)`, and **Save**.
4. After a minute, open the published URL on your phone
   (`https://<you>.github.io/<repo>/`).
5. Tap the browser's **Share → Add to Home Screen** to play it like an app.

**Option B — Open the file directly:**

- Copy the folder onto your phone and open `index.html` in a browser, or
- Run a tiny local server on your computer and visit it from your phone on the
  same Wi-Fi:
  ```bash
  python3 -m http.server 8000
  # then on your phone: http://<your-computer-ip>:8000
  ```

## Controls

| On screen | Keyboard (desktop) | Action                          |
|-----------|--------------------|---------------------------------|
| D-pad     | Arrows / WASD      | Move / navigate menus           |
| A         | Z / Enter / Space  | Confirm, talk, advance text     |
| B         | X                  | Cancel / back                   |
| Start (≡) | Enter              | Open menu (Pokémon / Bag / Save)|

## Tips

- Talk to signs and walk into building doors with **A** (or just step on them).
- Lower a wild Pokémon's HP before throwing a ball for a better catch rate.
- Faint? You'll wake up back in Pallet Town, fully healed.

## Project layout

```
index.html        # shell + on-screen controls
css/style.css     # layout, Game-Boy-ish styling, responsive scaling
js/data.js        # Pokédex, moves, type chart, items, the world map
js/sprites.js     # pixel-art renderer + all sprite data
js/engine.js      # overworld: tiles, camera, movement, encounters
js/battle.js      # turn-based battle system
js/main.js        # game state, leveling/evolution, menus, save/load, loop
```

Enjoy, and gotta catch 'em all! 🔴
