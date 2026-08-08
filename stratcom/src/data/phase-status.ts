/**
 * Phase 0 progress, as rendered by the shell.
 *
 * This mirrors `docs/CHECKLIST.md` Phase 0 by hand. It is a display artefact, not a
 * source of truth: when a checklist item changes state, change it in both places.
 */

export type ItemState = "done" | "blocked" | "todo";

export interface ChecklistItem {
  readonly label: string;
  readonly state: ItemState;
}

export const PHASE_0_STATUS: readonly ChecklistItem[] = [
  { label: "Vite + React 18 + TS scaffold, Vitest, kernel-purity ESLint rule", state: "done" },
  { label: "Port kernel/kernel.mjs → src/kernel/model.ts", state: "blocked" },
  { label: "Port calibration/ → calibration/*.test.ts; wire npm run calibrate", state: "blocked" },
  { label: "Gate: ten-war harness reproduces the documented baseline", state: "blocked" },
  { label: "Commit baseline numbers to docs/CALIBRATION-BASELINE.md", state: "blocked" },
];

export interface MissingAsset {
  readonly path: string;
  readonly what: string;
}

/** Named in docs/KICKOFF.md §"What you are starting from"; none are present. */
export const MISSING_SOURCE_ASSETS: readonly MissingAsset[] = [
  { path: "kernel/kernel.mjs", what: "the calibrated simulation, ~1,100 lines of ESM" },
  { path: "calibration/cases.mjs", what: "ten historical wars with observation bands" },
  { path: "calibration/fit.mjs", what: "loss function, random search, coordinate descent" },
  { path: "calibration/sens.mjs", what: "parameter sensitivity analysis" },
  { path: "calibration/render.mjs", what: "renders the visual language to standalone SVG" },
  { path: "kernel/legacy-ui-reference.jsx", what: "reference-only UI; source of the visual language" },
];
