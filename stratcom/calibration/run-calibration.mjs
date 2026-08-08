#!/usr/bin/env node
/**
 * `npm run calibrate` — the gate.
 *
 * CLAUDE.md non-negotiable #1: this command runs the simulation against ten
 * historical wars and reports train and held-out loss; a change that regresses
 * held-out loss is rejected.
 *
 * Right now it cannot do that, because the ported harness does not exist yet. The
 * important property of this script is therefore what it does NOT do: it never exits
 * 0. A gate that reports success while measuring nothing is worse than no gate — it
 * would launder every later phase's "harness still green" check into a no-op.
 *
 * When `calibration/*.test.ts` lands (Phase 0, checklist item 3), this delegates to
 * Vitest and the exit code becomes the harness's own.
 */

import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

/**
 * Assets named in `docs/KICKOFF.md` §"What you are starting from". The port in
 * Phase 0 reads from these; without them there is nothing to port and no baseline to
 * reproduce.
 */
const SOURCE_ASSETS = [
  ["kernel/kernel.mjs", "the calibrated simulation, ~1,100 lines of plain ESM"],
  ["calibration/cases.mjs", "ten historical wars with observation bands"],
  ["calibration/fit.mjs", "loss function, random search, coordinate descent"],
  ["calibration/sens.mjs", "parameter sensitivity analysis"],
];

/** Has the harness actually been ported? */
function portedHarnessFiles() {
  if (!existsSync(here)) return [];
  return readdirSync(here).filter((f) => f.endsWith(".test.ts"));
}

function fail(lines) {
  console.error("");
  console.error("  CALIBRATION GATE — CANNOT RUN");
  console.error("  " + "─".repeat(60));
  for (const line of lines) console.error("  " + line);
  console.error("");
  process.exit(1);
}

const ported = portedHarnessFiles();

if (ported.length === 0) {
  const missing = SOURCE_ASSETS.filter(([p]) => !existsSync(join(repoRoot, p)));

  if (missing.length > 0) {
    fail([
      "The ten-war harness has not been ported, and its source assets are not",
      "in this repository:",
      "",
      ...missing.map(([p, what]) => `  ${p.padEnd(28)} ${what}`),
      "",
      "These are listed in docs/KICKOFF.md as the starting point for Phase 0.",
      "Add them to the repository, then port them per docs/CHECKLIST.md Phase 0.",
      "",
      "No baseline has been recorded. The figures in KICKOFF (train ~2.8,",
      "held out ~3.4) describe the previous codebase; they are orientation,",
      "not a measurement taken here, and must not be copied into",
      "docs/CALIBRATION-BASELINE.md as though they were.",
    ]);
  }

  fail([
    "Source assets are present but the harness has not been ported to",
    "calibration/*.test.ts yet (docs/CHECKLIST.md, Phase 0, item 3).",
  ]);
}

console.log(`\n  Running the calibration harness (${ported.length} file(s))...\n`);

const result = spawnSync(
  process.execPath,
  [join(repoRoot, "node_modules", "vitest", "vitest.mjs"), "run", relative(repoRoot, here)],
  { cwd: repoRoot, stdio: "inherit" },
);

process.exit(result.status ?? 1);
