/**
 * Test-data analysis: descriptive statistics, regression, residuals and
 * uncertainty.
 *
 * Design rule: RAW DATA IS NEVER MODIFIED. Every exclusion or transformation
 * is a separate, recorded operation with a reason, and the original series is
 * always retained.
 */

export interface DescriptiveStats {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  range: number;
  /** Sample standard deviation (n-1 denominator). */
  stdDev: number;
  variance: number;
  /** Standard error of the mean. */
  stdError: number;
  /** Half-width of the 95% confidence interval on the mean. */
  ci95HalfWidth: number;
  coefficientOfVariation: number;
  q1: number;
  q3: number;
  iqr: number;
}

/**
 * Two-sided 95% critical values of Student's t, df = 1..30.
 * Standard published table values; above df = 30 a smooth approximation
 * converging to the normal value 1.95996 is used.
 */
const T95: number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];

export function tCritical95(df: number): number {
  if (df < 1) return NaN;
  if (df <= 30) return T95[Math.floor(df) - 1];
  // Continuity-preserving approximation for large df (Peiser-type expansion).
  const z = 1.959964;
  return z + (z * z * z + z) / (4 * df);
}

export function describe(values: number[]): DescriptiveStats {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) {
    return {
      n: 0, mean: NaN, median: NaN, min: NaN, max: NaN, range: NaN, stdDev: NaN,
      variance: NaN, stdError: NaN, ci95HalfWidth: NaN, coefficientOfVariation: NaN,
      q1: NaN, q3: NaN, iqr: NaN,
    };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const stdError = n > 0 ? stdDev / Math.sqrt(n) : NaN;
  return {
    n,
    mean,
    median: quantile(sorted, 0.5),
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    stdDev,
    variance,
    stdError,
    ci95HalfWidth: n > 1 ? tCritical95(n - 1) * stdError : NaN,
    coefficientOfVariation: mean !== 0 ? stdDev / Math.abs(mean) : NaN,
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
  };
}

/** Linear-interpolated quantile of an already-sorted array. */
export function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/* ------------------------------------------------------------------ */
/* Outliers — flagged, never deleted                                   */
/* ------------------------------------------------------------------ */

export interface OutlierFlag {
  index: number;
  value: number;
  method: "modified-z" | "iqr";
  score: number;
  threshold: number;
  reason: string;
}

/**
 * Flag candidate outliers by two independent, robust criteria. Neither
 * removes anything: an outlier is a prompt to look at the measurement, not a
 * licence to delete it.
 *
 *  - Modified z-score (Iglewicz & Hoaglin, NIST/SEMATECH e-Handbook 1.3.5.17):
 *      M_i = 0.6745 (x_i - median) / MAD,  flagged above 3.5
 *  - Tukey fence: outside Q1 - 1.5*IQR .. Q3 + 1.5*IQR
 */
export function flagOutliers(values: number[]): OutlierFlag[] {
  const flags: OutlierFlag[] = [];
  const clean = values.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
  if (clean.length < 4) return flags;
  const sorted = clean.map((p) => p.v).sort((a, b) => a - b);
  const med = quantile(sorted, 0.5);
  const deviations = clean.map((p) => Math.abs(p.v - med)).sort((a, b) => a - b);
  const mad = quantile(deviations, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;

  for (const { v, i } of clean) {
    if (mad > 0) {
      const m = (0.6745 * (v - med)) / mad;
      if (Math.abs(m) > 3.5) {
        flags.push({
          index: i,
          value: v,
          method: "modified-z",
          score: m,
          threshold: 3.5,
          reason: `Modified z-score ${m.toFixed(2)} exceeds 3.5 (Iglewicz & Hoaglin criterion). Check the instrument reading and the run log before deciding what to do — do NOT delete it without a physical reason.`,
        });
        continue;
      }
    }
    if (iqr > 0 && (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr)) {
      flags.push({
        index: i,
        value: v,
        method: "iqr",
        score: v < q1 ? (q1 - v) / iqr : (v - q3) / iqr,
        threshold: 1.5,
        reason: "Outside the Tukey 1.5 x IQR fence. This is a weak flag; small samples routinely produce one.",
      });
    }
  }
  return flags;
}

/* ------------------------------------------------------------------ */
/* Regression                                                          */
/* ------------------------------------------------------------------ */

export interface FitResult {
  model: string;
  /** Coefficients, meaning depends on the model. */
  coefficients: number[];
  coefficientNames: string[];
  /** Standard error of each coefficient. */
  coefficientStdErrors: number[];
  /** 95% CI half-width for each coefficient. */
  coefficientCi95: number[];
  rSquared: number;
  adjustedRSquared: number;
  rmse: number;
  mae: number;
  n: number;
  degreesOfFreedom: number;
  residuals: { x: number; observed: number; predicted: number; residual: number; standardized: number }[];
  predict: (x: number) => number;
  warnings: string[];
  equation: string;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // After full Gauss-Jordan elimination the system is diagonal.
  return M.map((row, i) => row[n] / row[i]);
}

/** Ordinary least squares polynomial fit of the given degree. */
export function polynomialFit(x: number[], y: number[], degree: number): FitResult {
  const warnings: string[] = [];
  const pairs = x.map((xi, i) => ({ x: xi, y: y[i] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pairs.length;
  const p = degree + 1;

  if (n < p) {
    return emptyFit(`polynomial degree ${degree}`, [
      `Only ${n} usable point(s) for a fit needing at least ${p}. No fit was performed.`,
    ]);
  }
  if (n === p) {
    warnings.push(
      `The number of points equals the number of coefficients, so the fit passes exactly through every point. R^2 will be 1 and means nothing. Collect more data.`,
    );
  }

  // Normal equations
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const b: number[] = new Array(p).fill(0);
  for (const pt of pairs) {
    const powers = Array.from({ length: 2 * degree + 1 }, (_, k) => Math.pow(pt.x, k));
    for (let i = 0; i < p; i++) {
      b[i] += powers[i] * pt.y;
      for (let j = 0; j < p; j++) A[i][j] += powers[i + j];
    }
  }
  const coeffs = solveLinearSystem(A, b);
  if (!coeffs) {
    return emptyFit(`polynomial degree ${degree}`, [
      "The normal equations are singular — the x values are probably all identical or nearly so. No fit was performed.",
    ]);
  }

  const predict = (xi: number) => coeffs.reduce((s, c, k) => s + c * Math.pow(xi, k), 0);
  const yMean = pairs.reduce((s, pt) => s + pt.y, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  let absSum = 0;
  const residuals = pairs.map((pt) => {
    const pred = predict(pt.x);
    const res = pt.y - pred;
    ssRes += res * res;
    ssTot += (pt.y - yMean) ** 2;
    absSum += Math.abs(res);
    return { x: pt.x, observed: pt.y, predicted: pred, residual: res, standardized: 0 };
  });
  const df = n - p;
  const mse = df > 0 ? ssRes / df : NaN;
  const rmse = Math.sqrt(df > 0 ? mse : ssRes / n);
  const s = Math.sqrt(mse);
  for (const r of residuals) r.standardized = s > 0 ? r.residual / s : 0;

  // Coefficient standard errors from (X'X)^-1 * MSE
  const inv = invertMatrix(A);
  const stdErrors = inv ? inv.map((row, i) => Math.sqrt(Math.max(0, row[i] * mse))) : coeffs.map(() => NaN);
  const tc = df > 0 ? tCritical95(df) : NaN;

  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
  const adjusted = df > 0 && ssTot > 0 ? 1 - (ssRes / df) / (ssTot / (n - 1)) : NaN;

  if (Number.isFinite(rSquared) && rSquared < 0.8 && n > p + 2) {
    warnings.push(`R^2 = ${rSquared.toFixed(3)}. The model explains less than 80% of the variation — check the residual plot for structure before quoting this fit.`);
  }

  return {
    model: degree === 1 ? "linear" : `polynomial degree ${degree}`,
    coefficients: coeffs,
    coefficientNames: coeffs.map((_, i) => (i === 0 ? "intercept" : `x^${i}`)),
    coefficientStdErrors: stdErrors,
    coefficientCi95: stdErrors.map((se) => tc * se),
    rSquared,
    adjustedRSquared: adjusted,
    rmse,
    mae: absSum / n,
    n,
    degreesOfFreedom: df,
    residuals,
    predict,
    warnings,
    equation:
      degree === 1
        ? `y = ${coeffs[1].toPrecision(6)} * x + ${coeffs[0].toPrecision(6)}`
        : `y = ` + coeffs.map((c, i) => (i === 0 ? c.toPrecision(6) : `${c.toPrecision(6)}*x^${i}`)).join(" + "),
  };
}

export function linearFit(x: number[], y: number[]): FitResult {
  return polynomialFit(x, y, 1);
}

/**
 * Power-law fit y = a * x^b, obtained by ordinary least squares on
 * log(y) = log(a) + b log(x).
 *
 * NOTE: this minimises error in LOG space, which weights small values more
 * heavily than a true non-linear least squares fit would. That is stated in
 * the warnings because for drag data (where y ~ V^2 is expected) it changes
 * the exponent slightly.
 */
export function powerLawFit(x: number[], y: number[]): FitResult {
  const warnings: string[] = [
    "Fitted by linear regression on log-transformed data, so the residuals minimised are in log space, not in the original units. For a definitive coefficient, follow up with a non-linear least-squares fit.",
  ];
  const pairs = x.map((xi, i) => ({ x: xi, y: y[i] })).filter((p) => p.x > 0 && p.y > 0 && Number.isFinite(p.x) && Number.isFinite(p.y));
  const dropped = x.length - pairs.length;
  if (dropped > 0) {
    warnings.push(`${dropped} point(s) with a non-positive x or y could not be log-transformed and were excluded from THIS FIT ONLY. The raw data is unchanged.`);
  }
  if (pairs.length < 2) return emptyFit("power law y = a*x^b", [...warnings, "Fewer than 2 usable points."]);

  const lin = polynomialFit(pairs.map((p) => Math.log(p.x)), pairs.map((p) => Math.log(p.y)), 1);
  const a = Math.exp(lin.coefficients[0]);
  const b = lin.coefficients[1];
  const predict = (xi: number) => a * Math.pow(xi, b);

  const yMean = pairs.reduce((s, p) => s + p.y, 0) / pairs.length;
  let ssRes = 0;
  let ssTot = 0;
  let absSum = 0;
  const residuals = pairs.map((p) => {
    const pred = predict(p.x);
    const res = p.y - pred;
    ssRes += res * res;
    ssTot += (p.y - yMean) ** 2;
    absSum += Math.abs(res);
    return { x: p.x, observed: p.y, predicted: pred, residual: res, standardized: 0 };
  });
  const df = pairs.length - 2;
  const rmse = Math.sqrt(df > 0 ? ssRes / df : ssRes / pairs.length);
  for (const r of residuals) r.standardized = rmse > 0 ? r.residual / rmse : 0;

  return {
    model: "power law y = a*x^b",
    coefficients: [a, b],
    coefficientNames: ["a", "b (exponent)"],
    coefficientStdErrors: [a * lin.coefficientStdErrors[0], lin.coefficientStdErrors[1]],
    coefficientCi95: [a * lin.coefficientCi95[0], lin.coefficientCi95[1]],
    rSquared: ssTot > 0 ? 1 - ssRes / ssTot : NaN,
    adjustedRSquared: df > 0 && ssTot > 0 ? 1 - (ssRes / df) / (ssTot / (pairs.length - 1)) : NaN,
    rmse,
    mae: absSum / pairs.length,
    n: pairs.length,
    degreesOfFreedom: df,
    residuals,
    predict,
    warnings,
    equation: `y = ${a.toPrecision(6)} * x^${b.toPrecision(6)}`,
  };
}

function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

function emptyFit(model: string, warnings: string[]): FitResult {
  return {
    model,
    coefficients: [],
    coefficientNames: [],
    coefficientStdErrors: [],
    coefficientCi95: [],
    rSquared: NaN,
    adjustedRSquared: NaN,
    rmse: NaN,
    mae: NaN,
    n: 0,
    degreesOfFreedom: 0,
    residuals: [],
    predict: () => NaN,
    warnings,
    equation: "—",
  };
}

/* ------------------------------------------------------------------ */
/* Prediction vs measurement                                           */
/* ------------------------------------------------------------------ */

export interface ComparisonResult {
  n: number;
  meanPredicted: number;
  meanMeasured: number;
  bias: number;
  biasPercent: number;
  rmse: number;
  mae: number;
  maxAbsError: number;
  /** Multiplicative factor that would best align prediction with measurement. */
  calibrationFactor: number;
  /** 95% CI half-width on the calibration factor. */
  calibrationFactorCi95: number;
  rSquared: number;
  verdict: string;
  warnings: string[];
}

/**
 * Compare a set of model predictions with measurements.
 *
 * The calibration factor is the least-squares slope through the origin,
 * k = sum(p*m) / sum(p*p), which is the natural scaling for a model whose
 * form is believed correct but whose magnitude is off.
 */
export function comparePredictionToMeasurement(predicted: number[], measured: number[]): ComparisonResult {
  const warnings: string[] = [];
  const pairs = predicted
    .map((p, i) => ({ p, m: measured[i] }))
    .filter((r) => Number.isFinite(r.p) && Number.isFinite(r.m));
  const n = pairs.length;
  if (n === 0) {
    return {
      n: 0, meanPredicted: NaN, meanMeasured: NaN, bias: NaN, biasPercent: NaN, rmse: NaN,
      mae: NaN, maxAbsError: NaN, calibrationFactor: NaN, calibrationFactorCi95: NaN,
      rSquared: NaN, verdict: "No comparable pairs.", warnings: ["No comparable prediction/measurement pairs were supplied."],
    };
  }
  const meanP = pairs.reduce((s, r) => s + r.p, 0) / n;
  const meanM = pairs.reduce((s, r) => s + r.m, 0) / n;
  let ssErr = 0;
  let absSum = 0;
  let maxAbs = 0;
  let sumPM = 0;
  let sumPP = 0;
  for (const r of pairs) {
    const e = r.p - r.m;
    ssErr += e * e;
    absSum += Math.abs(e);
    maxAbs = Math.max(maxAbs, Math.abs(e));
    sumPM += r.p * r.m;
    sumPP += r.p * r.p;
  }
  const rmse = Math.sqrt(ssErr / n);
  const k = sumPP > 0 ? sumPM / sumPP : NaN;
  // Standard error of the through-origin slope.
  let ssResK = 0;
  for (const r of pairs) ssResK += (r.m - k * r.p) ** 2;
  const seK = n > 1 && sumPP > 0 ? Math.sqrt(ssResK / (n - 1) / sumPP) : NaN;
  const ciK = n > 1 ? tCritical95(n - 1) * seK : NaN;

  let ssTot = 0;
  for (const r of pairs) ssTot += (r.m - meanM) ** 2;
  const rSquared = ssTot > 0 ? 1 - ssErr / ssTot : NaN;

  const bias = meanP - meanM;
  const biasPct = meanM !== 0 ? (bias / Math.abs(meanM)) * 100 : NaN;

  let verdict: string;
  const relRmse = meanM !== 0 ? rmse / Math.abs(meanM) : NaN;
  if (!Number.isFinite(relRmse)) verdict = "Cannot judge agreement: the measured mean is zero.";
  else if (relRmse < 0.1) verdict = `Prediction and measurement agree to within ${(relRmse * 100).toFixed(0)}% RMS. For a preliminary model at this scale that is good agreement.`;
  else if (relRmse < 0.3) verdict = `Prediction and measurement differ by ${(relRmse * 100).toFixed(0)}% RMS. That is typical for a first-pass hydrodynamic buildup — usable for trend work, not for a quoted performance figure.`;
  else verdict = `Prediction and measurement differ by ${(relRmse * 100).toFixed(0)}% RMS. Something structural is likely wrong: a missing drag source, a wrong reference area, or an incorrect assumption rather than a coefficient that needs tuning.`;

  if (n < 4) warnings.push(`Only ${n} pair(s) compared. A calibration factor from this few points is not meaningful — collect more runs.`);
  if (Number.isFinite(k) && Math.abs(k - 1) > 0.5) {
    warnings.push(`The calibration factor is ${k.toFixed(2)}, far from 1. Applying a factor this large hides a modelling error rather than correcting it. Investigate the physics before calibrating.`);
  }
  warnings.push("Calibrating a model to its own validation data removes the independence of that validation. Hold back some runs, or state clearly in the report which data was used to fit and which to check.");

  return {
    n,
    meanPredicted: meanP,
    meanMeasured: meanM,
    bias,
    biasPercent: biasPct,
    rmse,
    mae: absSum / n,
    maxAbsError: maxAbs,
    calibrationFactor: k,
    calibrationFactorCi95: ciK,
    rSquared,
    verdict,
    warnings,
  };
}

/** Repeatability: pooled standard deviation over repeated runs of the same condition. */
export function repeatability(groups: number[][]): {
  pooledStdDev: number;
  repeatabilityLimit95: number;
  groupCount: number;
  totalPoints: number;
  note: string;
} {
  let ss = 0;
  let df = 0;
  let total = 0;
  for (const g of groups) {
    const clean = g.filter((v) => Number.isFinite(v));
    if (clean.length < 2) continue;
    const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
    ss += clean.reduce((s, v) => s + (v - mean) ** 2, 0);
    df += clean.length - 1;
    total += clean.length;
  }
  const pooled = df > 0 ? Math.sqrt(ss / df) : NaN;
  return {
    pooledStdDev: pooled,
    // ISO 5725 repeatability limit r = 2.8 * s_r for two results.
    repeatabilityLimit95: 2.8 * pooled,
    groupCount: groups.length,
    totalPoints: total,
    note:
      "Pooled within-condition standard deviation. The repeatability limit is 2.8 x s_r, the ISO 5725 value below which the absolute difference between two independent results under repeatability conditions is expected to lie 95% of the time.",
  };
}
