# CLAUDE.md — working agreement for this repository

## What this project is

STRATCOM is an educational geopolitical conflict simulator. It models wars between
real states at a strategic level of abstraction: economies, manpower, logistics,
morale, intelligence and escalation. It is **not** an operational planning tool and
must never become one.

## Non-negotiables

1. **The calibration gate.** `npm run calibrate` runs the simulation against ten
   historical wars and reports train and held-out loss. A change that regresses
   held-out loss is rejected, however good it looks. Train loss alone proves
   nothing — we have already caught one overfit this way.

2. **Kernel purity.** `src/kernel/` runs under plain Node with no React, no DOM, no
   MapLibre imports. This is what lets the harness and the Monte Carlo worker run.
   Enforced by lint rule; do not add an exception.

3. **Abstraction level.** Formations and regions, never individual targets. No
   strike packages, no facility-level vulnerability detail, no optimised attack
   routing. The simulation answers "what happens to a war when fuel is cut", not
   "how would one attack this place". Several spec sections say this explicitly;
   they are load-bearing, not boilerplate.

4. **Fog of war is a type boundary.** UI code that renders enemy formations must be
   structurally unable to import the true formation type. Enemy information comes
   from `Contact` records only.

5. **No fabricated geography or imagery.** If a tile source, DEM or photograph is
   unavailable, degrade gracefully and say so in the UI. Never synthesise something
   that reads as real data. Generated or simulated imagery carries a permanent
   in-image label.

6. **Provenance survives.** Country fields are tagged `[O]` observed, `[E]`
   estimated, `[A]` abstraction. Keep the tags and surface them.

## Conventions

- TypeScript strict. No `any` in `src/kernel/`.
- Kernel state is a plain mutable object advanced by `step(state)`. Do not
  introduce immutability ceremony; the Monte Carlo path depends on this being cheap.
- One MapLibre layer per file under `src/map/layers/`.
- Numbers shown to users get units and, where they derive from `[A]` fields, a
  visual marker.
- Comments explain *why*, especially where a constant is calibrated. If you change a
  calibrated constant, say in the comment what evidence justified it.

## Working style

Work in the phases in `docs/CHECKLIST.md`. Each phase must end with the app running
and the calibration gate green. Do not start a phase by refactoring the previous
one. If a phase reveals the plan is wrong, say so and propose the change rather than
quietly diverging.
