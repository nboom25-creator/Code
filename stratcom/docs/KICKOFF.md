# Kickoff — first session

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md` §§1–4. Those four sections contain
every decision that is already made. Do not re-open them.

## What you are starting from

- `kernel/kernel.mjs` — the working, calibrated simulation. ~1,100 lines, plain ESM,
  no dependencies. This is the asset.
- `calibration/` — the ten-war harness, the fitter and the sensitivity script.
- `kernel/legacy-ui-reference.jsx` — the current single-file React app. **Reference
  only.** Do not port it wholesale; it is a spectator UI built for an abstract
  1-D front. Mine it for the visual language (palette, typography, the SVG chart
  components, the operational map styling) and for how the kernel is driven.

## Session 1 goal — Phase 0 only

Get the kernel into the repo as typed TypeScript with the calibration gate green.
Nothing else. No map, no UI.

The gate matters more than it looks. Ported code that runs is not the same as ported
code that reproduces the fit. Run `npm run calibrate` and compare against the
documented baseline before you claim the phase is done.

## Documented baseline (10 wars, 7 train / 3 held out)

Record the exact numbers you get in `docs/CALIBRATION-BASELINE.md` on first run.
Known properties of the current fit, for orientation:

- Train mean loss around 2.8 after fitting; held-out around 3.4
- **The gap is real and expected** — this model overfits its training wars. The
  hold-out number is the one that matters.
- Known unfixed defects, both documented in ARCHITECTURE §4:
  - casualty ordering is inverted between WWI and Ukraine
  - `MAX_ADV` is too low for mobile warfare, which leaves culmination inert

Do not "fix" these in Phase 0. They are Phase 4 work and they need the geographic
substrate to fix properly.

## What good looks like at the end of session 1

```
npm run calibrate
  TRAIN     mean loss 2.8xx  (7 wars)
  HELD OUT  mean loss 3.3xx  (3 wars)
```

and a commit that changes no simulation behaviour whatsoever.
