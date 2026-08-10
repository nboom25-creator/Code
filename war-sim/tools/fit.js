#!/usr/bin/env node
/* =============================================================================
 * tools/fit.js — fit the model's free coefficients to the historical backtest.
 *
 * The numbers in `K` (js/model.js) are the part of this model that is genuinely
 * arbitrary. They were originally set by hand until the results looked right,
 * which is exactly the process a backtest exists to replace. This script
 * searches them instead.
 *
 * HOW IT AVOIDS FOOLING ITSELF
 *
 *  - Six of the fifteen wars are held out and never scored during the search.
 *    Overfitting shows up as a gap between the fitting score and the holdout
 *    score. Nine cases against a dozen parameters is still a poor ratio and the
 *    gap should be read as a warning, not a formality.
 *
 *  - The objective is continuous — log-ratio error on duration and casualties
 *    plus probability mass on the true outcome — rather than the pass/fail
 *    counts the report shows. Counting passes is far too coarse and noisy a
 *    surface to optimise on; a model can halve its error without flipping a
 *    single pass.
 *
 *  - Coordinate descent with multiplicative steps, three sweeps. Not because
 *    it is sophisticated but because it is legible: every move it makes can be
 *    read off the log and argued with.
 *
 * Usage:  node tools/fit.js [--sweeps 3] [--iters 120] [--reg 0.35] [--quick]
 * Writes nothing. Prints the fitted K for you to paste into js/model.js.
 * ========================================================================== */

const { load, massOn, runCase } = require("./harness");

const args = process.argv.slice(2);
const argv = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? +args[i + 1] : def;
};
const QUICK = args.includes("--quick");
const SWEEPS = argv("sweeps", QUICK ? 1 : 3);
const ITERS = argv("iters", QUICK ? 60 : 120);

// Multiplicative steps tried for each coefficient on each sweep.
const STEPS = QUICK ? [0.7, 1, 1.4] : [0.55, 0.75, 0.9, 1, 1.15, 1.4, 1.9];

/* Regularisation toward the hand-set priors. Nine fitting cases against a dozen
 * coefficients is not enough data to pin a dozen numbers, and an unregularised
 * search proves it: bounded but unpenalised, it improved the fitting score by
 * 12% while making the held-out score 4% WORSE. That is the definition of
 * memorising the test set.
 *
 * The penalty is squared log-distance from the prior, so a coefficient only
 * moves far if the evidence is strong. Set --reg 0 to see the unregularised
 * result, which is instructive and should not be shipped. */
const LAMBDA = argv("reg", 0.35);

// Coefficients that are exponents want additive steps, not multiplicative —
// scaling an exponent by 1.9 is not a small move.
const EXPONENTS = new Set(["tolExp", "qualExch", "biteExp"]);

/* Plausibility bounds. Without these the search happily drives cohesion to
 * "units break after losing 9% of their strength" and all but deletes the
 * technology term, because those choices shave a little off the objective on
 * nine particular wars. A coefficient outside these ranges is not a discovery,
 * it is the optimiser exploiting the loss function, and a model fitted that way
 * would be indefensible the moment anyone asked what the number meant.
 *
 * Each range is what the quantity could defensibly be, argued independently of
 * the backtest. The fit is then the best available answer WITHIN what is
 * physically sayable, which is the only kind worth having. */
const BOUNDS = {
  // An offensive against an intact line is slow; against a collapsed one it is
  // limited by fuel trucks, not by the enemy. 2003 covered 500 km in three
  // weeks, so the upper bound has to allow most of a country in a month.
  advBase:   [0.010, 0.120],
  advMano:   [0.100, 1.400],
  lossBase:  [0.020, 0.090],   // monthly materiel attrition at full contact
  casBase:   [0.010, 0.060],   // monthly casualties, share of engaged
  defBase:   [1.150, 1.800],   // the 1.5:1 planning rule, give or take
  tolScale:  [0.020, 0.150],   // casualty tolerance ceiling
  tolExp:    [1.000, 2.500],
  transBase: [0.050, 0.400],   // even a dictatorship feels some of it
  stallW:    [0.030, 0.200],
  cohBase:   [0.250, 0.700],   // below 25% loss it is not an army breaking
  qualExch:  [0.300, 1.100],   // a generational gap matters, but not infinitely
  biteExp:   [0.300, 0.800],
  /* Termination by decision. A leadership that has concluded the position is
   * hopeless decides in days to weeks, not years — Iraq accepted the 1991
   * ceasefire within days of the ground war opening, Georgia sued for terms in
   * five, Argentina surrendered days after the final assault on Stanley. So the
   * monthly hazard at full hopelessness is well above 1. The upper bound is
   * "the decision takes about a week"; below the lower bound the mechanism is
   * slower than the attrition it is supposed to pre-empt and does nothing.
   * The shipped value is 2.0 and the backtest is FLAT across this entire range,
   * which is the main reason to believe the gain is not fitted. */
  capRate:   [0.500, 5.000],
  // How far ahead a government discounts. Shorter than a war and longer than a
  // campaign season: nobody concedes over a reverse they expect to outlast, and
  // nobody plans a surrender around year three.
  capHorizon: [3.000, 15.000],
  // How far an existential aim suppresses conceding. At 0 a state hands over
  // its own existence as readily as a border province, which is Germany 1945
  // ending in 1943; at 1 conquest can never be conceded at all, which is Vichy
  // France being impossible.
  capStake:  [0.400, 0.950],
  // Envelopment. Both are off by default (envRate 0) and excluded from the
  // search below; the bounds are here so that turning them on does not leave
  // them unbounded.
  envRatio:  [1.500, 4.000],
  envRate:   [0.100, 1.200],
  envPocket: [0.080, 0.400],
  wdrRate:   [0.100, 2.000],
};
const clampK = (name, v) => {
  const b = BOUNDS[name];
  return b ? Math.max(b[0], Math.min(b[1], v)) : v;
};

const { WarData, WarModel, WarBacktest } = load();
const { CASES, isHoldout } = WarBacktest;
const M = WarModel;

// Log-ratio error, bounded so one hopeless case cannot dominate the sum.
const lr = (pred, act) => {
  if (!(act > 0)) return 0;
  return Math.min(3, Math.abs(Math.log(Math.max(pred, 1e-6) / act)));
};

function loss(which, iterations) {
  const cases = CASES.filter((c) =>
    which === "all" ? true : which === "holdout" ? isHoldout(c.id) : !isHoldout(c.id));
  let total = 0;
  for (const c of cases) {
    const r = runCase(M, WarData, c, iterations);
    total +=
      1.00 * (1 - massOn(r.outcomeBreakdown, c.actual.outcome) / 100) +
      0.60 * lr(r.expected.months, c.actual.months) +
      0.35 * (lr(r.expected.killedA, c.actual.killedA) +
              lr(r.expected.killedB, c.actual.killedB)) / 2;
  }
  return total / cases.length;
}

const PRIOR = { ...M.K };
/* Coefficients the search is allowed to move. A coefficient whose prior is zero
 * is a mechanism that has been deliberately switched off after being measured
 * (see sections 7b and 11b of the model), and it is excluded for two reasons:
 * the squared-log-distance penalty is undefined at a prior of zero, and a
 * fitter that silently switches a disabled mechanism back on because it shaves
 * a little off nine cases is precisely the failure this script exists to
 * demonstrate rather than commit. */
const NAMES = Object.keys(PRIOR).filter((n) => PRIOR[n] > 0);
const FROZEN = Object.keys(PRIOR).filter((n) => !(PRIOR[n] > 0));

function reg(k) {
  let sum = 0;
  for (const n of NAMES) {
    const r = Math.log(Math.max(k[n], 1e-9) / PRIOR[n]);
    sum += r * r;
  }
  return sum / NAMES.length;
}

const setK = (k) => Object.assign(M.K, k);
// Fitting score carries the penalty; the holdout score never does, so the two
// numbers stay comparable as measurements of the same thing.
const evaluate = (k, which) => {
  setK(k);
  const l = loss(which, ITERS);
  return which !== "fit" || !LAMBDA ? l : l + LAMBDA * reg(k);
};
const rawEvaluate = (k, which) => { setK(k); return loss(which, ITERS); };

let K = { ...PRIOR };
const t0 = process.hrtime.bigint();
const secs = () => Number(process.hrtime.bigint() - t0) / 1e9;

let best = evaluate(K, "fit");
const baseFit = rawEvaluate(K, "fit");
const baseHold = rawEvaluate(K, "holdout");
console.log(`regularisation lambda ${LAMBDA}`);
console.log(`baseline   fit ${baseFit.toFixed(4)}   holdout ${baseHold.toFixed(4)}`);
console.log(`searching ${NAMES.length} coefficients, ${SWEEPS} sweeps, ${ITERS} iterations/case`);
if (FROZEN.length) console.log(`frozen at zero (disabled mechanisms): ${FROZEN.join(", ")}`);
console.log();

for (let sweep = 1; sweep <= SWEEPS; sweep++) {
  for (const name of NAMES) {
    const cur = K[name];
    const raw = EXPONENTS.has(name)
      ? [cur - 0.3, cur - 0.15, cur, cur + 0.15, cur + 0.3]
      : STEPS.map((m) => cur * m);
    const candidates = [...new Set(raw.map((v) => clampK(name, v)))];

    let bestVal = cur, bestLoss = best;
    for (const v of candidates) {
      if (v === cur) continue;
      const l = evaluate({ ...K, [name]: v }, "fit");
      if (l < bestLoss - 1e-5) { bestLoss = l; bestVal = v; }
    }
    if (bestVal !== cur) {
      const delta = ((bestLoss - best) / best) * 100;
      console.log(
        `sweep ${sweep}  ${name.padEnd(11)} ${cur.toFixed(4)} → ${bestVal.toFixed(4)}` +
        `   loss ${best.toFixed(4)} → ${bestLoss.toFixed(4)} (${delta.toFixed(1)}%)`);
      K[name] = bestVal;
      best = bestLoss;
    }
  }
  const hold = evaluate(K, "holdout");
  console.log(`--- sweep ${sweep} done: fit ${best.toFixed(4)}   holdout ${hold.toFixed(4)}   ` +
              `${secs().toFixed(0)}s\n`);
}

const finalFit = rawEvaluate(K, "fit");
const finalHold = rawEvaluate(K, "holdout");
console.log("=".repeat(72));
console.log(`fit      ${baseFit.toFixed(4)} → ${finalFit.toFixed(4)}   ` +
            `(${(((finalFit - baseFit) / baseFit) * 100).toFixed(1)}%)`);
console.log(`holdout  ${baseHold.toFixed(4)} → ${finalHold.toFixed(4)}   ` +
            `(${(((finalHold - baseHold) / baseHold) * 100).toFixed(1)}%)`);
const gap = finalHold / finalFit;
console.log(`holdout/fit ratio ${gap.toFixed(2)}` +
  (gap > 1.6 ? "  ← OVERFITTING: the gain is mostly memorisation" :
   gap > 1.25 ? "  ← some overfitting; treat the fitted values as soft" :
                "  ← generalising"));
console.log("=".repeat(72));
console.log("\n  const K = {");
for (const n of Object.keys(PRIOR)) {
  console.log(`    ${(n + ":").padEnd(12)}${(K[n] ?? PRIOR[n]).toFixed(4)},`);
}
console.log("  };");
