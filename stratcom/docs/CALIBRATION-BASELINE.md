# Calibration baseline

**Status: NOT ESTABLISHED.** No baseline has been measured in this repository.

`docs/CHECKLIST.md` Phase 0 item 5 asks for the baseline numbers to be committed
here on first run. `npm run calibrate` has never produced numbers, because the
harness it would run does not exist yet (see below). This file is a placeholder that
records that fact rather than leaving it to be inferred from an empty file.

## Why the gate has not run

`docs/KICKOFF.md` §"What you are starting from" names the assets Phase 0 ports. None
of them are in this repository:

| Asset | What it is |
|---|---|
| `kernel/kernel.mjs` | the calibrated simulation, ~1,100 lines of plain ESM |
| `calibration/cases.mjs` | ten historical wars with observation bands |
| `calibration/fit.mjs` | loss function, random search, coordinate descent |
| `calibration/sens.mjs` | parameter sensitivity analysis |
| `calibration/render.mjs` | renders the visual language to standalone SVG |
| `kernel/legacy-ui-reference.jsx` | reference-only UI; source of the visual language |

`README.md` describes these under "Contents" and states that the kernel "works and is
calibrated against ten historical wars". That describes the previous codebase. It is
not true of this repository as it currently stands.

## The numbers in KICKOFF are not a baseline

KICKOFF gives, for orientation:

```
TRAIN     mean loss 2.8xx  (7 wars)
HELD OUT  mean loss 3.3xx  (3 wars)
```

These are **properties of the previous fit, quoted from a document** — not
measurements taken here. They must not be copied into this file as though they were
results. CLAUDE.md non-negotiable #1 exists precisely because a plausible-looking
number is indistinguishable from a real one at a glance, and every later phase gate
("harness still reproduces Phase 0 numbers") would inherit the fiction.

`calibration/run-calibration.mjs` enforces the same thing mechanically: it exits
non-zero and refuses to report success while the harness is absent.

## What to record here on first real run

Once the assets are present and the harness is ported:

1. Run `npm run calibrate`.
2. Paste the exact train and held-out figures below, with the date and the commit
   they were measured at.
3. Note the seven training wars and the three held out, so later refits compare
   like with like.

Held-out loss is the number that matters. A train-loss improvement on its own is not
evidence — KICKOFF notes the train/held-out gap is real and expected, and that one
overfit has already been caught this way.

### Measurements

_None yet._
