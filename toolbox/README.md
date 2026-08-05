# 🧰 Toolbox

Turns the sensors already in your phone into a set of small, single-purpose
tools. Everything runs offline — no accounts, no network calls, no analytics.

Built with **React Native + Expo**, so the same code runs on iOS and Android.

## Tools so far

| Tool           | What it uses     | What it does                                                  |
| -------------- | ---------------- | ------------------------------------------------------------- |
| **Level**      | Accelerometer    | Bubble level for flat surfaces, edge mode for hanging things. Buzzes when true. |
| **Flashlight** | Camera torch     | Steady, strobe at 2/5/10 Hz, and a morse SOS beacon. Plus a full-screen lamp. |
| **Stopwatch**  | —                | Laps and splits, fastest and slowest highlighted.              |

## Run it

```bash
cd toolbox
npm install
npm start
```

Then scan the QR code with **Expo Go** ([iOS](https://apps.apple.com/app/expo-go/id982107779) /
[Android](https://play.google.com/store/apps/details?id=host.exp.exponent)), or press
`i` / `a` for a simulator.

The sensor tools need a real device — a simulator has no accelerometer and no
torch. The browser (`npm run web`) can't drive the torch at all, so the
flashlight falls back to the screen lamp there.

## Adding a tool

Each tool is one self-contained file that receives an `onBack` prop and wraps
itself in `<ToolScreen>`. To add one:

1. Drop `src/tools/YourTool.js` next to the others.
2. Add a row to the array in `src/tools/index.js`.

That's it — the home grid, navigation, and Android back button pick it up
automatically.

## Layout

```
App.js                    # home grid + routing between tools
src/theme.js              # shared colours and spacing
src/components/           # ToolScreen chrome, Button
src/tools/index.js        # the tool registry
src/tools/*.js            # one file per tool
```
