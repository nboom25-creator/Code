# STRATCOM — Architecture

## The one thing to understand first

The existing simulation kernel is **calibrated** against ten historical wars. That
calibration is the most expensive thing in this project and the easiest to destroy.

The kernel currently resolves a war on a **one-dimensional front** divided into 4–7
sectors inside a named theater. There are no coordinates anywhere in it.

This rebuild replaces the *spatial substrate* — 1-D sectors become a real
geographic cell grid — while leaving the **resolution mathematics unchanged**.
Combat power, Lanchester casualties, railhead-limited supply, mobilisation
ceilings, escalation and intelligence all keep their current form and constants.

If a change to the kernel makes `npm run calibrate` regress, the change is wrong,
regardless of how much better the map looks.

---

## 1. Stack (decided — do not relitigate)

| Concern | Decision | Why |
|---|---|---|
| App shell | **Vite + React 18 + TypeScript** | Map-heavy client app; SSR buys nothing and complicates MapLibre |
| Map | **MapLibre GL JS v4** | Open, no licence restrictions, terrain + globe support built in |
| Basemap tiles | **Protomaps (PMTiles)**, self-hosted | Single-file tile archive, no API key, no per-view billing |
| Terrain DEM | **AWS Terrain Tiles** (Terrarium encoding) | Public, MapLibre reads it natively for hillshade + 3D |
| Satellite | **MapTiler Satellite** behind an env key | Only licensable option that is cheap; degrade gracefully if absent |
| Night lights | **NASA Black Marble** | Public domain |
| Boundaries | **Natural Earth admin-0/1** | Public domain, includes disputed-area variants |
| Cell grid | **H3 (`h3-js`) resolution 4** | ~22 km edge, ~1,770 km²; ~560 cells per large theater |
| State | **Zustand** | Kernel state is a plain object mutated per tick; Redux ceremony is not warranted |
| Charts | **D3** (bespoke SVG, as in the legacy UI) | Existing visual language is hand-rolled SVG; keep it |
| Tests | **Vitest** | Calibration harness runs as a test suite |

No backend. Geodata is preprocessed offline by scripts in `scripts/` and shipped as
static assets. If tile hosting is later needed, add it then — not now.

---

## 2. Repository layout

```
stratcom/
├─ src/
│  ├─ kernel/            # simulation — NO react, NO map, NO dom
│  │  ├─ model.ts        # ported from kernel/kernel.mjs
│  │  ├─ geo.ts          # NEW: cell grid, front extraction, supply graph
│  │  ├─ bridge.ts       # NEW: sectors <-> cells (see §4)
│  │  └─ types.ts
│  ├─ map/               # MapLibre layers, one file per overlay
│  ├─ ui/                # War Room shell, panels, cards
│  ├─ data/              # generated geodata loaders
│  └─ state/
├─ scripts/              # offline data pipeline (Node, run manually)
├─ public/data/          # generated artefacts, committed
├─ calibration/          # the ten-war harness — CI gate
└─ docs/
```

**Hard rule:** `src/kernel/` must never import from `src/map/` or `src/ui/`, and must
run under plain Node. That is what lets the calibration harness execute headlessly.

---

## 3. The geographic model

### Cells

A theater is a bounding polygon filled with H3 res-4 cells. Each cell carries
**static** attributes, precomputed once by `scripts/build-theater.ts`:

```ts
interface Cell {
  h3: string;            // H3 index
  lat: number; lng: number;
  elevation: number;     // mean, metres, from Terrarium DEM
  ruggedness: number;    // stddev of elevation within cell
  terrain: TerrainType;  // derived: landcover + ruggedness + hydrology
  population: number;    // GHSL
  railDensity: number;   // km of rail per 1000 km², OSM
  roadDensity: number;
  coastal: boolean;
  riverCrossing: boolean;
  country: string;       // ISO-3, Natural Earth
}
```

`terrain` must map onto the kernel's existing `TERRAIN` table (open, forest, hills,
river, urban, marsh) so the mobility, defence and rail modifiers already calibrated
continue to apply. Derivation rules live in `scripts/classify-terrain.ts` and are
the only place that mapping is allowed to exist.

### Runtime state

```ts
interface CellState {
  control: number;       // -1 = B holds, +1 = A holds, interpolated between
  entrenchA: number; entrenchB: number;
  supplyA: number; supplyB: number;
  damage: number;
  weather: WeatherId;
  observedA: number;     // A's observation confidence of this cell, 0-1
  observedB: number;
  lastSeenA: number;     // tick index
  lastSeenB: number;
}
```

### Front extraction

The front line is **not stored**. It is derived every tick as the zero-contour of
the `control` field via marching squares over the H3 grid, emitted as GeoJSON
`LineString`. This is what makes fronts follow real geography for free — the
contour bends around mountains because the control field does.

Styling per spec §9:
- **solid** where |∂control/∂t| over the last 6 ticks is near zero
- **dashed** where control is actively moving
- **faded** where the observing side's `observed*` is below 0.4
- **thickness** proportional to that segment's casualty rate

---

## 4. The bridge — how the calibrated kernel survives

This is the critical piece. `src/kernel/bridge.ts` does exactly two things:

**Downward (cells → sectors), once per tick:**
1. Walk the extracted front line and cut it into 4–7 contiguous **segments** of
   roughly equal length. These are the kernel's `sectors`.
2. For each segment, aggregate the cells within a corridor either side:
   - `width` = segment length in km
   - `terrain` = area-weighted dominant terrain of the corridor
   - `railA` / `railB` = graph distance from the segment to each side's nearest
     functioning supply node, converted to the kernel's 0–100 depth scale
   - `entA` / `entB` = mean entrenchment of the corridor cells

**Upward (sectors → cells), after resolution:**
3. The kernel returns an advance in km per sector. Convert that to a shift in the
   `control` field of the cells along that segment, weighted by each cell's
   terrain mobility so the line bulges where the ground is open.

Everything between steps 2 and 3 is the **existing, unmodified kernel**. Do not
reimplement combat on cells. The sectors are a view over the geography, not a
replacement for it.

### Known kernel defect to fix during this work

`MAX_ADV` is 20 km/month, calibrated on seven attritional wars. Real mobile
operations ran 300–600 km/month. Consequences already measured:

- supply stretch is 0–4 km in almost every scenario, so **culmination is inert**
- the Eastern Front 1941–45 case cannot be fitted at all

Fix: replace the single global ceiling with an advance rate that scales with the
attacker's mechanisation ratio and the defender's cohesion, then refit. Expect
`MAX_ADV` to become two parameters. **Re-run the hold-out validation afterwards** —
train loss improving is not evidence of anything.

---

## 5. Logistics graph (spec §16–18)

Nodes: ports, rail junctions and airfields at national/regional abstraction, from
OSM, deliberately coarse — no facility-level detail.

Edges: rail and road corridors, capacity from `railDensity` and line count.

Each tick, solve flow from national supply sources to front segments by iterative
relaxation (not max-flow; capacity is soft and we want partial-satisfaction values,
not a binary cut). Render edges with thickness = throughput, colour = efficiency,
and flag any edge above 90% utilisation as a bottleneck.

The kernel already computes a supply ratio per sector from railhead distance. The
graph **replaces that distance calculation** and nothing else.

---

## 6. Intelligence and fog (spec §12–15, 45)

Per side, per cell: `observed` confidence decaying exponentially with ticks since
last observation, refreshed by recon coverage polygons (satellite passes, air recon
under contested skies, UAV orbits, SIGINT footprints).

Contacts are records, not truth references:

```ts
interface Contact {
  id: string;
  believedCell: string;      // H3
  radiusKm: number;          // grows with age
  strengthLo: number; strengthHi: number;  // widens with age
  confidence: number;
  lastSeenTick: number;
  state: "unknown" | "possible" | "probable" | "confirmed" | "stale";
}
```

**Enemy unit cards read from `Contact`, never from the true formation object.** This
must be enforced by types: the UI layer should not be able to import the truth type
for an enemy formation. Put them in separate modules and lint the boundary.

Map fog treatment: desaturate and lower contrast on low-`observed` cells. Never
blur text.

---

## 7. Imagery policy (spec §34–36)

- Real photographs only where public domain or explicitly licensed; store the
  licence and attribution in `public/data/imagery-credits.json` and render it.
- Where none is available, use **SVG silhouettes** for equipment categories. Do not
  generate photorealistic imagery and do not imply generated images are real.
- Any scenario imagery must carry a persistent `SIMULATED IMAGE` label that is part
  of the image element, not a caption that can be cropped away.
- The same applies to the news system: every in-simulation article is labelled
  simulated in the card itself.

---

## 8. Data provenance (carried over — keep it)

The kernel already tags country fields as observed `[O]`, estimated `[E]` or
abstraction `[A]`. Surface that in the UI: any number shown to the user that derives
from an `[A]` field should be visually distinguishable from one derived from `[O]`.
Users must be able to tell a measurement from a design parameter.

---

## 9. Performance budget

- 60 fps map interaction at theater zoom with ~600 cells and all overlays off
- One simulation tick under 8 ms so replay at 10× stays smooth
- Monte Carlo: 300 headless runs under 6 s — run in a Web Worker, never on the main
  thread. The kernel's Node-only purity is what makes this possible; protect it.
