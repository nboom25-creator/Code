/**
 * First-order (linear) uncertainty propagation — the standard GUM / Kline &
 * McClintock approach used throughout undergraduate lab work.
 *
 *   u_y = sqrt( sum_i ( (df/dx_i) * u_i )^2 )
 *
 * The partial derivatives are evaluated numerically with a central difference
 * so that any JS function can be wrapped. This is a *linearised* estimate: it
 * assumes the uncertainties are small relative to the values and that the
 * function is locally smooth. Both assumptions are reported to the caller.
 */

export interface UncertainInput {
  name: string;
  value: number;
  /** Standard uncertainty (1 sigma), absolute, same units as value. */
  uncertainty: number;
}

export interface UncertaintyResult {
  value: number;
  /** Combined standard uncertainty (1 sigma). */
  uncertainty: number;
  /** Expanded uncertainty at the requested coverage factor. */
  expanded: number;
  coverageFactor: number;
  /** Relative contribution of each input to the total variance, 0..1. */
  contributions: { name: string; sensitivity: number; contribution: number; share: number }[];
  warnings: string[];
}

export function propagate(
  f: (values: Record<string, number>) => number,
  inputs: UncertainInput[],
  coverageFactor = 2,
): UncertaintyResult {
  const warnings: string[] = [];
  const base: Record<string, number> = {};
  for (const i of inputs) base[i.name] = i.value;

  const value = f(base);
  if (!Number.isFinite(value)) {
    return {
      value: NaN,
      uncertainty: NaN,
      expanded: NaN,
      coverageFactor,
      contributions: [],
      warnings: ["Nominal function evaluation did not return a finite value."],
    };
  }

  const contributions: UncertaintyResult["contributions"] = [];
  let variance = 0;

  for (const input of inputs) {
    if (!Number.isFinite(input.uncertainty) || input.uncertainty === 0) {
      contributions.push({ name: input.name, sensitivity: 0, contribution: 0, share: 0 });
      continue;
    }
    // Step size: small relative to the value, but never zero.
    const h =
      Math.abs(input.value) > 0 ? Math.abs(input.value) * 1e-6 : Math.abs(input.uncertainty) * 1e-3 || 1e-9;
    const up = { ...base, [input.name]: input.value + h };
    const down = { ...base, [input.name]: input.value - h };
    const fUp = f(up);
    const fDown = f(down);
    if (!Number.isFinite(fUp) || !Number.isFinite(fDown)) {
      warnings.push(
        `Could not evaluate the sensitivity to "${input.name}" (function returned a non-finite value when perturbed); its contribution is omitted.`,
      );
      contributions.push({ name: input.name, sensitivity: NaN, contribution: 0, share: 0 });
      continue;
    }
    const sensitivity = (fUp - fDown) / (2 * h);
    const contribution = sensitivity * input.uncertainty;
    variance += contribution * contribution;
    contributions.push({ name: input.name, sensitivity, contribution, share: 0 });

    if (Math.abs(input.value) > 0 && Math.abs(input.uncertainty / input.value) > 0.2) {
      warnings.push(
        `"${input.name}" has a relative uncertainty above 20%; the first-order (linearised) propagation used here may understate the true uncertainty.`,
      );
    }
  }

  const uncertainty = Math.sqrt(variance);
  for (const c of contributions) {
    c.share = variance > 0 ? (c.contribution * c.contribution) / variance : 0;
  }

  return {
    value,
    uncertainty,
    expanded: uncertainty * coverageFactor,
    coverageFactor,
    contributions: contributions.sort((a, b) => b.share - a.share),
    warnings,
  };
}

/** Convenience: relative uncertainty as a fraction (not %). */
export function relative(value: number, uncertainty: number): number {
  return value === 0 ? NaN : Math.abs(uncertainty / value);
}

/** Combine independent uncertainties in quadrature. */
export function quadrature(...values: number[]): number {
  return Math.sqrt(values.reduce((s, v) => s + (Number.isFinite(v) ? v * v : 0), 0));
}
