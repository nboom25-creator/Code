# STRATCOM

An educational geopolitical conflict simulator. Models wars between real states at a
strategic level: economies, demographics, logistics, morale, intelligence and
escalation. Outcomes emerge from the model; nothing is scripted.

**This is not an operational planning tool.** Everything resolves at the level of
formations and regions. There are no strike packages, no facility-level detail and
no attack routing, by design.

## Status

The simulation kernel works and is calibrated against ten historical wars spanning
1915–2020. This repository is the rebuild of its spatial layer from an abstract
1-D front onto real geography, plus a command-centre interface.

## Start here

1. `CLAUDE.md` — the working agreement, including the non-negotiables
2. `docs/ARCHITECTURE.md` — stack, the geographic model, and how the calibration survives
3. `docs/KICKOFF.md` — what to do in the first session
4. `docs/CHECKLIST.md` — the phased plan

## Contents

```
kernel/kernel.mjs             calibrated simulation, plain ESM, no dependencies
kernel/legacy-ui-reference.jsx  current single-file app — reference only
calibration/cases.mjs         ten historical wars with observation bands
calibration/fit.mjs           loss function, random search, coordinate descent
calibration/sens.mjs          parameter sensitivity analysis
calibration/render.mjs        renders the visual language to standalone SVG
```

## The calibration gate

`npm run calibrate` is the gate on every change to `src/kernel/`. Held-out loss is
the number that matters; training loss improving on its own is not evidence.
