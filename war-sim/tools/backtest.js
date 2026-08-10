#!/usr/bin/env node
/* =============================================================================
 * tools/backtest.js — run the fifteen historical wars from the command line.
 *
 * Same cases, same `simulate()`, same scoring as the in-app backtest panel.
 * This exists so the score can be checked in a terminal, diffed between two
 * versions of the model, and read by whoever is changing a coefficient at the
 * time. A model with a backtest you have to open a browser to see is a model
 * whose backtest gets run rarely.
 *
 * Usage:
 *   node tools/backtest.js                 # 800 iterations per case
 *   node tools/backtest.js --iters 200     # faster, noisier
 *   node tools/backtest.js --json          # machine-readable, for diffing
 * ========================================================================== */

const { load, runCase } = require("./harness");

const args = process.argv.slice(2);
const argv = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? +args[i + 1] : def;
};
const ITERS = argv("iters", 800);
const JSON_OUT = args.includes("--json");

const { WarData, WarModel, WarBacktest } = load();
const { CASES, scoreCase, isHoldout } = WarBacktest;

const rows = CASES.map((c) => {
  const result = runCase(WarModel, WarData, c, ITERS);
  return { case: c, result, score: scoreCase(c, result) };
});

const summarise = (rs) => ({
  n: rs.length,
  outcomes: rs.filter((r) => r.score.outcomeOk).length,
  durations: rs.filter((r) => r.score.durationOk).length,
  casualties: rs.filter((r) => r.score.casualtiesOk).length,
  meanMass: rs.reduce((s, r) => s + r.score.mass, 0) / rs.length,
});

const cal = WarBacktest.calibration(rows);
const all = summarise(rows);
const fit = summarise(rows.filter((r) => !isHoldout(r.case.id)));
const held = summarise(rows.filter((r) => isHoldout(r.case.id)));

if (JSON_OUT) {
  console.log(JSON.stringify({
    iterations: ITERS,
    summary: { all, fit, holdout: held },
    calibration: cal,
    cases: rows.map((r) => ({
      id: r.case.id, name: r.case.name, holdout: isHoldout(r.case.id),
      predicted: r.score.predicted, actual: r.score.actualOutcome,
      outcomeOk: r.score.outcomeOk,
      months: +r.score.months.toFixed(2), actualMonths: r.case.actual.months,
      durationOk: r.score.durationOk,
      killedA: Math.round(r.score.killedA), killedB: Math.round(r.score.killedB),
      actualKilledA: r.case.actual.killedA, actualKilledB: r.case.actual.killedB,
      casualtiesOk: r.score.casualtiesOk,
      mass: +r.score.mass.toFixed(1),
    })),
  }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const tick = (b) => (b === null ? " " : b ? "✓" : "✗");

console.log(`\n${ITERS} iterations per case, seed 424242. * = held out from fitting.\n`);
console.log(pad("", 2) + pad("war", 22) + pad("model", 12) + pad("actual", 12) +
            lpad("mo", 7) + lpad("actual", 8) + "  " + pad("", 3) +
            lpad("mass", 6) + "  out dur cas");
console.log("─".repeat(88));

for (const r of rows) {
  const s = r.score;
  const actualMo = r.case.actual.months;
  console.log(
    pad(isHoldout(r.case.id) ? "*" : "", 2) +
    pad(r.case.name + " " + r.case.when, 22) +
    pad(s.predicted, 12) +
    pad(s.actualOutcome, 12) +
    lpad(s.months.toFixed(1), 7) +
    lpad(actualMo != null ? actualMo.toFixed(2) : "—", 8) + "  " +
    pad("", 3) +
    lpad(s.mass.toFixed(0) + "%", 6) + "   " +
    tick(s.outcomeOk) + "   " + tick(s.durationOk) + "   " + tick(s.casualtiesOk));
}

console.log("─".repeat(88));
const line = (label, s) =>
  `${pad(label, 10)} outcomes ${s.outcomes}/${s.n}   durations ${s.durations}/${s.n}   ` +
  `casualties ${s.casualties}/${s.n}   mean mass ${s.meanMass.toFixed(0)}%`;
console.log(line("all", all));
console.log(line("fitting", fit));
console.log(line("holdout", held));

/* The pass counts above are legible and coarse. These grade the distribution
 * the model actually produces, which is the only fair test of a forecast. */
const p1 = (v) => (v == null ? "  n/a" : (v * 100).toFixed(0) + "%");
console.log("\n" + "─".repeat(88));
console.log("CALIBRATION — grading the distribution, not the mean\n");
console.log(`  Brier      ${cal.brier.toFixed(3)}   vs base rate ${cal.baseBrier.toFixed(3)}` +
            `   skill ${(cal.brierSkill * 100).toFixed(0)}%`);
console.log(`  Log score  ${cal.logScore.toFixed(3)}   vs base rate ${cal.baseLog.toFixed(3)}` +
            `   skill ${(cal.logSkill * 100).toFixed(0)}%`);
const T = cal.tempering;
console.log(`  Tempered toward the base rate at t=${T.t.toFixed(2)}: ` +
            `Brier ${T.brier.toFixed(3)} (skill ${(T.brierSkill * 100).toFixed(0)}%), ` +
            `log ${T.logScore.toFixed(3)} (skill ${(T.logSkill * 100).toFixed(0)}%)`);
console.log(`\n  Duration    mean PIT ${cal.duration.meanPit.toFixed(2)} (0.50 = unbiased)` +
            `   in 50% band ${p1(cal.duration.cover50)} (want 50%)` +
            `   in 90% band ${p1(cal.duration.cover90)} (want 90%)`);
console.log(`  Casualties  mean PIT ${cal.casualties.meanPit.toFixed(2)}` +
            `                              in 90% band ${p1(cal.casualties.cover90)} (want 90%)`);
console.log("\n  Reliability — of every case-and-outcome forecast:");
cal.reliability.forEach((b) => {
  if (!b.count) return;
  const lab = `${(b.lo * 100).toFixed(0)}–${Math.min(100, b.hi * 100).toFixed(0)}%`;
  console.log(`    model said ${lab.padEnd(8)} (mean ${p1(b.predicted).padStart(4)})` +
              `  →  actually happened ${p1(b.observed).padStart(4)}   n=${b.count}`);
});
console.log();
