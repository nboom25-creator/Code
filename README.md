# 🐍 Snake

A simple, minimal Snake arcade game built with **React Native + Expo**. Runs on
iOS, Android, and the web from a single codebase.

> Also in this repo: **[`war-sim/`](war-sim/)** — *Theatre*, a conflict model
> built on real order-of-battle data for 74 countries. No build step; open
> `war-sim/index.html` in a browser.

## Play

- **Swipe** anywhere on the board to steer the snake (up / down / left / right).
- On desktop/web, use the on-screen **D-pad** buttons.
- Eat the red food to grow and score. Don't hit the walls or yourself.

## Run it

You'll need [Node.js](https://nodejs.org) installed.

```bash
# 1. install dependencies
npm install

# 2. start the dev server
npm start
```

Then:

- **On your phone** — install the **Expo Go** app
  ([iOS](https://apps.apple.com/app/expo-go/id982107779) /
  [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))
  and scan the QR code shown in the terminal.
- **In a browser** — press `w` in the terminal (or run `npm run web`).
- **Simulator** — press `i` for the iOS simulator or `a` for an Android emulator.

## Tweak it

Everything lives in `App.js`. A few knobs at the top:

| Constant   | What it does                                  |
| ---------- | --------------------------------------------- |
| `GRID`     | Board size in cells (default `18 × 18`)       |
| `TICK_MS`  | Game speed — lower is faster (default `140`)  |

## Project layout

```
App.js            # the whole game (logic + UI)
app.json          # Expo app config
package.json      # dependencies & scripts
babel.config.js   # Babel preset for Expo
```
