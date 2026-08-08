/**
 * Kernel types.
 *
 * Everything in this file is transcribed from decisions already made in
 * `docs/ARCHITECTURE.md` §3 (cells, runtime state) and §6 (intelligence). Nothing
 * here is invented, and nothing here encodes simulation *behaviour* — the resolution
 * mathematics arrives with the port of `kernel/kernel.mjs` into `model.ts`.
 *
 * This module must stay importable from plain Node. See CLAUDE.md non-negotiable #2.
 */

/**
 * Terrain classes, per ARCHITECTURE §3.
 *
 * These names are load-bearing: they must map onto the kernel's existing `TERRAIN`
 * table so the already-calibrated mobility, defence and rail modifiers keep
 * applying. Do not add, rename or reorder a member without refitting — that is a
 * change to a calibrated surface, not a tidy-up.
 *
 * The derivation from landcover/ruggedness/hydrology belongs in
 * `scripts/classify-terrain.ts` and nowhere else (ARCHITECTURE §3).
 */
export type TerrainType = "open" | "forest" | "hills" | "river" | "urban" | "marsh";

/**
 * Weather identifier.
 *
 * ARCHITECTURE §3 places this on `CellState` but does not enumerate it; the weather
 * model is Phase 8, where ERA5 climatology defines the real set. Left as a nominal
 * alias so the shape of `CellState` is right now and widening it later is a typed
 * change rather than a silent one.
 */
export type WeatherId = string & { readonly __brand: "WeatherId" };

/** H3 cell index, resolution 4 (~22 km edge, ~1,770 km²). ARCHITECTURE §1. */
export type H3Index = string;

/** ISO-3166 alpha-3 country code, from Natural Earth. */
export type Iso3 = string;

/**
 * Static per-cell attributes, precomputed once by `scripts/build-theater.ts`.
 * ARCHITECTURE §3.
 */
export interface Cell {
  /** H3 index. */
  h3: H3Index;
  lat: number;
  lng: number;
  /** Mean elevation in metres, from the Terrarium DEM. */
  elevation: number;
  /** Standard deviation of elevation within the cell. */
  ruggedness: number;
  /** Derived from landcover + ruggedness + hydrology. */
  terrain: TerrainType;
  /** From GHSL. */
  population: number;
  /** Kilometres of rail per 1,000 km², from OSM. */
  railDensity: number;
  /** Kilometres of road per 1,000 km², from OSM. */
  roadDensity: number;
  coastal: boolean;
  riverCrossing: boolean;
  country: Iso3;
}

/**
 * Mutable per-cell simulation state. ARCHITECTURE §3.
 *
 * Mutated in place by `step(state)` — CLAUDE.md is explicit that the Monte Carlo
 * path depends on this being cheap, so do not wrap it in immutability ceremony.
 */
export interface CellState {
  /** -1 = B holds, +1 = A holds, interpolated between. */
  control: number;
  entrenchA: number;
  entrenchB: number;
  supplyA: number;
  supplyB: number;
  damage: number;
  weather: WeatherId;
  /** A's observation confidence for this cell, 0–1. */
  observedA: number;
  /** B's observation confidence for this cell, 0–1. */
  observedB: number;
  /** Tick index at which A last observed this cell. */
  lastSeenA: number;
  /** Tick index at which B last observed this cell. */
  lastSeenB: number;
}

/** How far a contact has decayed. ARCHITECTURE §6. */
export type ContactState =
  | "unknown"
  | "possible"
  | "probable"
  | "confirmed"
  | "stale";

/**
 * What one side believes about an enemy formation. ARCHITECTURE §6.
 *
 * A `Contact` is a *record*, not a reference to truth. Enemy unit cards read from
 * this and never from the true formation object — CLAUDE.md non-negotiable #4 makes
 * that a structural guarantee, enforced by the boundary rule in `eslint.config.js`
 * and exercised in `src/kernel-purity.test.ts`. When the truth type for formations
 * lands, it goes in a module the UI layer cannot import.
 */
export interface Contact {
  id: string;
  /** H3 cell where the formation is believed to be. */
  believedCell: H3Index;
  /** Grows with age. */
  radiusKm: number;
  /** Low end of the strength estimate; the band widens with age. */
  strengthLo: number;
  /** High end of the strength estimate; the band widens with age. */
  strengthHi: number;
  confidence: number;
  lastSeenTick: number;
  state: ContactState;
}

/**
 * Provenance tag. CLAUDE.md non-negotiable #6 and ARCHITECTURE §8.
 *
 * Carried over from the existing kernel's country fields. Any number surfaced to a
 * user that derives from an `[A]` field must be visually distinguishable from one
 * derived from `[O]` — users have to be able to tell a measurement from a design
 * parameter.
 */
export type Provenance = "O" | "E" | "A";

/** A scalar shown to users, carrying where it came from. ARCHITECTURE §8. */
export interface Tagged<T> {
  value: T;
  provenance: Provenance;
  /** Free-text source note, e.g. "SIPRI 2024" — rendered where space allows. */
  source?: string;
}
