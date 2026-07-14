/**
 * Deterministic unit conversion and dimensional-analysis helpers.
 *
 * This is the in-process fallback for the Python calc service (SymPy/Pint). It
 * is intentionally small but CORRECT for the common engineering units, and it
 * is heavily unit-tested. The AI never does arithmetic that this or the calc
 * service can verify.
 *
 * Dimensions are tracked as exponents over SI base dimensions:
 *   M mass, L length, T time, I current, K temperature, N amount, J luminous.
 */

export type Dim = { M: number; L: number; T: number; I: number; K: number; N: number; J: number };

const ZERO: Dim = { M: 0, L: 0, T: 0, I: 0, K: 0, N: 0, J: 0 };

export function dim(partial: Partial<Dim>): Dim {
  return { ...ZERO, ...partial };
}

export function dimEqual(a: Dim, b: Dim): boolean {
  return (["M", "L", "T", "I", "K", "N", "J"] as const).every((k) => a[k] === b[k]);
}

export function dimMul(a: Dim, b: Dim): Dim {
  return {
    M: a.M + b.M, L: a.L + b.L, T: a.T + b.T, I: a.I + b.I,
    K: a.K + b.K, N: a.N + b.N, J: a.J + b.J,
  };
}
export function dimPow(a: Dim, n: number): Dim {
  return { M: a.M * n, L: a.L * n, T: a.T * n, I: a.I * n, K: a.K * n, N: a.N * n, J: a.J * n };
}

/** A unit: factor to SI base + offset (for °C/°F absolute temperature). */
interface UnitDef {
  dim: Dim;
  factor: number; // multiply value by this to get SI base value
  offset?: number; // added AFTER scaling, for affine temperatures
}

// Base + common derived/engineering units. factor converts TO SI base units.
export const UNITS: Record<string, UnitDef> = {
  // dimensionless
  "": { dim: dim({}), factor: 1 },
  "1": { dim: dim({}), factor: 1 },
  rad: { dim: dim({}), factor: 1 },

  // mass
  kg: { dim: dim({ M: 1 }), factor: 1 },
  g: { dim: dim({ M: 1 }), factor: 1e-3 },
  mg: { dim: dim({ M: 1 }), factor: 1e-6 },
  lb: { dim: dim({ M: 1 }), factor: 0.45359237 }, // pound-mass
  lbm: { dim: dim({ M: 1 }), factor: 0.45359237 },
  slug: { dim: dim({ M: 1 }), factor: 14.5939029 },

  // length
  m: { dim: dim({ L: 1 }), factor: 1 },
  cm: { dim: dim({ L: 1 }), factor: 1e-2 },
  mm: { dim: dim({ L: 1 }), factor: 1e-3 },
  km: { dim: dim({ L: 1 }), factor: 1e3 },
  in: { dim: dim({ L: 1 }), factor: 0.0254 },
  ft: { dim: dim({ L: 1 }), factor: 0.3048 },
  mi: { dim: dim({ L: 1 }), factor: 1609.344 },

  // time
  s: { dim: dim({ T: 1 }), factor: 1 },
  ms: { dim: dim({ T: 1 }), factor: 1e-3 },
  min: { dim: dim({ T: 1 }), factor: 60 },
  h: { dim: dim({ T: 1 }), factor: 3600 },
  hr: { dim: dim({ T: 1 }), factor: 3600 },

  // current / charge
  A: { dim: dim({ I: 1 }), factor: 1 },
  mA: { dim: dim({ I: 1 }), factor: 1e-3 },

  // temperature (absolute). °C/°F handled via offset; ONLY valid for absolute
  // temperatures, not temperature differences (see convert()).
  K: { dim: dim({ K: 1 }), factor: 1 },
  degC: { dim: dim({ K: 1 }), factor: 1, offset: 273.15 },
  degF: { dim: dim({ K: 1 }), factor: 5 / 9, offset: 255.372222222 },

  // force
  N: { dim: dim({ M: 1, L: 1, T: -2 }), factor: 1 },
  kN: { dim: dim({ M: 1, L: 1, T: -2 }), factor: 1e3 },
  lbf: { dim: dim({ M: 1, L: 1, T: -2 }), factor: 4.4482216153 },

  // energy
  J: { dim: dim({ M: 1, L: 2, T: -2 }), factor: 1 },
  kJ: { dim: dim({ M: 1, L: 2, T: -2 }), factor: 1e3 },
  cal: { dim: dim({ M: 1, L: 2, T: -2 }), factor: 4.184 },
  BTU: { dim: dim({ M: 1, L: 2, T: -2 }), factor: 1055.05585 },

  // power
  W: { dim: dim({ M: 1, L: 2, T: -3 }), factor: 1 },
  kW: { dim: dim({ M: 1, L: 2, T: -3 }), factor: 1e3 },
  hp: { dim: dim({ M: 1, L: 2, T: -3 }), factor: 745.699872 },

  // pressure
  Pa: { dim: dim({ M: 1, L: -1, T: -2 }), factor: 1 },
  kPa: { dim: dim({ M: 1, L: -1, T: -2 }), factor: 1e3 },
  MPa: { dim: dim({ M: 1, L: -1, T: -2 }), factor: 1e6 },
  bar: { dim: dim({ M: 1, L: -1, T: -2 }), factor: 1e5 },
  atm: { dim: dim({ M: 1, L: -1, T: -2 }), factor: 101325 },
  psi: { dim: dim({ M: 1, L: -1, T: -2 }), factor: 6894.757293 },

  // electrical
  V: { dim: dim({ M: 1, L: 2, T: -3, I: -1 }), factor: 1 },
  ohm: { dim: dim({ M: 1, L: 2, T: -3, I: -2 }), factor: 1 },
  F: { dim: dim({ M: -1, L: -2, T: 4, I: 2 }), factor: 1 }, // farad
  H: { dim: dim({ M: 1, L: 2, T: -2, I: -2 }), factor: 1 }, // henry

  // frequency / velocity
  Hz: { dim: dim({ T: -1 }), factor: 1 },
};

export class UnitError extends Error {}

function lookup(u: string): UnitDef {
  const def = UNITS[u];
  if (!def) throw new UnitError(`Unknown unit: "${u}"`);
  return def;
}

/**
 * Convert an absolute value from one unit to another. Throws UnitError on
 * incompatible dimensions. Offset units (°C/°F) are handled correctly for
 * ABSOLUTE temperatures.
 */
export function convert(value: number, from: string, to: string): number {
  const f = lookup(from);
  const t = lookup(to);
  if (!dimEqual(f.dim, t.dim)) {
    throw new UnitError(`Incompatible units: cannot convert ${from} to ${to}`);
  }
  const si = value * f.factor + (f.offset ?? 0);
  return (si - (t.offset ?? 0)) / t.factor;
}

/**
 * Convert a temperature DIFFERENCE (ΔT). Offsets are ignored — a 1 °C change
 * equals a 1 K change but 5 °F change equals 5*(5/9) K. This is the classic
 * gotcha the spec calls out.
 */
export function convertDelta(value: number, from: string, to: string): number {
  const f = lookup(from);
  const t = lookup(to);
  if (!dimEqual(f.dim, t.dim)) {
    throw new UnitError(`Incompatible units: cannot convert Δ${from} to Δ${to}`);
  }
  return (value * f.factor) / t.factor;
}

/** Are two units dimensionally compatible? */
export function compatible(a: string, b: string): boolean {
  return dimEqual(lookup(a).dim, lookup(b).dim);
}

/** Parse a compound unit like "kg*m/s^2" or "J/(kg*K)" into a Dim. */
export function parseCompoundDim(expr: string): Dim {
  // Tokenise into (unit, exponent, sign) using a simple recursive-ish parser.
  const cleaned = expr.replace(/\s+/g, "");
  if (cleaned === "" || cleaned === "1") return dim({});

  let result = dim({});
  // Split on top-level * and / while respecting parentheses.
  let i = 0;
  let sign = 1; // +1 multiply, -1 divide
  const readGroup = (): Dim => {
    if (cleaned[i] === "(") {
      i++; // consume (
      let depth = 1;
      const start = i;
      while (i < cleaned.length && depth > 0) {
        if (cleaned[i] === "(") depth++;
        else if (cleaned[i] === ")") depth--;
        if (depth > 0) i++;
      }
      const inner = cleaned.slice(start, i);
      i++; // consume )
      return parseCompoundDim(inner);
    }
    // read a unit token (letters/degree)
    const start = i;
    while (i < cleaned.length && /[A-Za-z]/.test(cleaned[i])) i++;
    const name = cleaned.slice(start, i);
    let exp = 1;
    if (cleaned[i] === "^") {
      i++;
      const eStart = i;
      if (cleaned[i] === "-") i++;
      while (i < cleaned.length && /[0-9.]/.test(cleaned[i])) i++;
      exp = parseFloat(cleaned.slice(eStart, i));
    }
    return dimPow(lookup(name).dim, exp);
  };

  while (i < cleaned.length) {
    const c = cleaned[i];
    if (c === "*") { sign = 1; i++; continue; }
    if (c === "/") { sign = -1; i++; continue; }
    const g = readGroup();
    result = dimMul(result, sign === 1 ? g : dimPow(g, -1));
  }
  return result;
}

/** Round a number to `sig` significant figures (returned as a string). */
export function toSigFigs(x: number, sig: number): string {
  if (x === 0) return "0";
  const d = Math.ceil(Math.log10(Math.abs(x)));
  const power = sig - d;
  const mag = Math.pow(10, power);
  const rounded = Math.round(x * mag) / mag;
  return String(rounded);
}
