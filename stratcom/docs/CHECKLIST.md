# Build checklist

Each phase ends with **working software** and a **green calibration gate**.

## Phase 0 — Scaffold and port  ⟵ start here
- [ ] Vite + React 18 + TS scaffold, Vitest, ESLint with the kernel-purity rule
- [ ] Port `kernel/kernel.mjs` to `src/kernel/model.ts`, typed, behaviour identical
- [ ] Port `calibration/` to `calibration/*.test.ts`; wire `npm run calibrate`
- [ ] **Gate:** ten-war harness reproduces the documented baseline losses
- [ ] Commit the baseline numbers to `docs/CALIBRATION-BASELINE.md`

## Phase 1 — Map shell
- [ ] MapLibre canvas, Protomaps PMTiles basemap, camera controls (zoom/pan/rotate/tilt)
- [ ] Style selector: political, terrain, satellite, night — the four that need only base data
- [ ] Graceful degradation when a source is missing, with a visible notice
- [ ] Global → theater → regional camera transitions

## Phase 2 — Terrain and the cell grid
- [ ] `scripts/build-theater.ts`: H3 res-4 fill, DEM sampling, landcover, OSM density
- [ ] `scripts/classify-terrain.ts`: the single mapping to the kernel's TERRAIN table
- [ ] Terrain view + 3D mode with exaggeration
- [ ] Click a cell → terrain type, elevation, and the mobility/defence/supply modifiers
      **read from the kernel's own table**, not duplicated

## Phase 3 — Control, fronts, and the bridge
- [ ] `control` field on cells; marching-squares front extraction to GeoJSON
- [ ] `src/kernel/bridge.ts` per ARCHITECTURE §4
- [ ] **Gate:** with the bridge in place, the harness still reproduces Phase 0 numbers
- [ ] Front styling: stable/contested/uncertain, thickness by intensity
- [ ] Territorial control overlay incl. contested and unknown

## Phase 4 — Fix the advance-rate defect
- [ ] Replace global `MAX_ADV` with mechanisation- and cohesion-dependent rate
- [ ] Refit, then **re-run hold-out**; record whether test loss moved
- [ ] Verify supply stretch becomes non-trivial and culmination actually binds
- [ ] Verify the Eastern Front case now reaches its observed movement band

## Phase 5 — Units and symbology
- [ ] NATO-style symbols, formation categories per spec §10
- [ ] Zoom-dependent display levels with clustering (§11)
- [ ] Friendly unit cards (§12)

## Phase 6 — Intelligence
- [ ] Per-cell observation confidence with decay; recon coverage overlays
- [ ] `Contact` records; ageing radius and widening estimate bands
- [ ] Enemy cards from contacts only; lint the type boundary
- [ ] Map fog: desaturation and contrast, never blurred text

## Phase 7 — Logistics
- [ ] Supply node/edge graph from OSM at coarse abstraction
- [ ] Iterative flow solve; replace the kernel's railhead distance with graph distance
- [ ] **Gate:** harness still green after the supply substitution
- [ ] Flow visualisation, throughput thickness, bottleneck warnings, unit supply states

## Phase 8 — Weather
- [ ] ERA5 climatology per cell per month + stochastic deviation, advected systems
- [ ] Weather overlay and the region weather panel with operational effects (§20)
- [ ] Effects wired into the kernel's existing seasonal modifiers, not alongside them

## Phase 9 — Air and naval
- [ ] Regional air-control overlays; mission arcs between regions, no coordinates
- [ ] Sea control/denial zones, shipping lanes, convoys
- [ ] Submarine probability zones (§28)

## Phase 10 — Thematic overlays
- [ ] Economic, population, energy, diplomatic, alliance, escalation, damage,
      humanitarian choropleths, each with a legend and provenance markers

## Phase 11 — War Room
- [ ] Shell: central map, left military, right intelligence, bottom timeline, top bar
- [ ] Tabs: map, command, intelligence, logistics, economy, diplomacy, news
- [ ] Country command screen (§33)
- [ ] Equipment cards with SVG silhouettes and attribution
- [ ] Simulated news system, labelled in-card
- [ ] Intelligence report viewer with map snippet

## Phase 12 — Timeline, replay, globe
- [ ] Operational timeline, clickable events that move the camera
- [ ] Replay with scrub and 1×/2×/5×/10×, driving all layers
- [ ] Strategic globe with crisis markers, click through to theater

## Phase 13 — Finish
- [ ] Reduced-motion support throughout
- [ ] Performance budget met (ARCHITECTURE §9)
- [ ] Provenance markers audited across every surfaced number
- [ ] Monte Carlo in a Web Worker with the fan chart
