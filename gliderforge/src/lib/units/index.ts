/**
 * GliderForge unit system.
 *
 * Design notes
 * ------------
 * The application deliberately implements its own unit registry rather than
 * pulling in a general-purpose conversion package. Reasons:
 *   1. Engineering results must carry an explicit *dimension*, so that a
 *      dimensional-consistency check can reject e.g. adding a pressure to a
 *      force. Most small conversion libraries only convert within a category
 *      and expose no dimension algebra.
 *   2. Every conversion factor used here is exact-by-definition (SI / NIST
 *      SP 811) so the numbers are auditable in review.
 *   3. Zero runtime dependencies keeps the calculation engine importable from
 *      unit tests, API routes and the browser alike.
 *
 * All internal computation happens in SI base units. Conversion to a display
 * unit happens only at the presentation boundary.
 */

export type Dimension =
  | "dimensionless"
  | "length"
  | "mass"
  | "time"
  | "area"
  | "volume"
  | "velocity"
  | "acceleration"
  | "force"
  | "pressure"
  | "density"
  | "energy"
  | "power"
  | "torque"
  | "angle"
  | "current"
  | "voltage"
  | "charge"
  | "temperature"
  | "frequency"
  | "currency"
  | "angularVelocity"
  | "dynamicViscosity"
  | "kinematicViscosity"
  | "moment";

export interface UnitDef {
  /** Canonical symbol as displayed to the user. */
  symbol: string;
  dimension: Dimension;
  /** value_SI = (value * factor) + offset */
  factor: number;
  offset?: number;
  /** Human label used in dropdowns. */
  label: string;
  system: "SI" | "US" | "other";
}

/** SI base unit for each dimension. Everything is stored internally in these. */
export const BASE_UNIT: Record<Dimension, string> = {
  dimensionless: "-",
  length: "m",
  mass: "kg",
  time: "s",
  area: "m^2",
  volume: "m^3",
  velocity: "m/s",
  acceleration: "m/s^2",
  force: "N",
  pressure: "Pa",
  density: "kg/m^3",
  energy: "J",
  power: "W",
  torque: "N*m",
  angle: "rad",
  current: "A",
  voltage: "V",
  charge: "C",
  temperature: "K",
  frequency: "Hz",
  currency: "USD",
  angularVelocity: "rad/s",
  dynamicViscosity: "Pa*s",
  kinematicViscosity: "m^2/s",
  moment: "N*m",
};

const U = (
  symbol: string,
  dimension: Dimension,
  factor: number,
  label: string,
  system: UnitDef["system"] = "SI",
  offset?: number,
): UnitDef => ({ symbol, dimension, factor, label, system, offset });

/**
 * Conversion factors.
 *  - 1 in = 0.0254 m exactly (international inch, NIST SP 811).
 *  - 1 lbm = 0.45359237 kg exactly.
 *  - 1 lbf = 4.4482216152605 N exactly (from standard gravity 9.80665 m/s^2).
 *  - 1 atm = 101325 Pa exactly; 1 bar = 1e5 Pa exactly; 1 psi = 1 lbf/in^2.
 */
const UNIT_LIST: UnitDef[] = [
  U("-", "dimensionless", 1, "dimensionless", "other"),
  U("%", "dimensionless", 0.01, "percent", "other"),

  // length
  U("m", "length", 1, "meter"),
  U("mm", "length", 1e-3, "millimeter"),
  U("cm", "length", 1e-2, "centimeter"),
  U("km", "length", 1e3, "kilometer"),
  U("in", "length", 0.0254, "inch", "US"),
  U("ft", "length", 0.3048, "foot", "US"),
  U("yd", "length", 0.9144, "yard", "US"),

  // mass
  U("kg", "mass", 1, "kilogram"),
  U("g", "mass", 1e-3, "gram"),
  U("mg", "mass", 1e-6, "milligram"),
  U("lb", "mass", 0.45359237, "pound-mass", "US"),
  U("oz", "mass", 0.028349523125, "ounce", "US"),

  // time
  U("s", "time", 1, "second"),
  U("ms", "time", 1e-3, "millisecond"),
  U("min", "time", 60, "minute"),
  U("h", "time", 3600, "hour"),
  U("day", "time", 86400, "day"),

  // area
  U("m^2", "area", 1, "square meter"),
  U("cm^2", "area", 1e-4, "square centimeter"),
  U("mm^2", "area", 1e-6, "square millimeter"),
  U("in^2", "area", 0.00064516, "square inch", "US"),
  U("ft^2", "area", 0.09290304, "square foot", "US"),

  // volume
  U("m^3", "volume", 1, "cubic meter"),
  U("L", "volume", 1e-3, "liter"),
  U("mL", "volume", 1e-6, "milliliter"),
  U("cm^3", "volume", 1e-6, "cubic centimeter"),
  U("cc", "volume", 1e-6, "cubic centimeter (cc)"),
  U("mm^3", "volume", 1e-9, "cubic millimeter"),
  U("in^3", "volume", 1.6387064e-5, "cubic inch", "US"),
  U("gal", "volume", 0.003785411784, "US gallon", "US"),

  // velocity
  U("m/s", "velocity", 1, "meter per second"),
  U("cm/s", "velocity", 1e-2, "centimeter per second"),
  U("km/h", "velocity", 1 / 3.6, "kilometer per hour"),
  U("ft/s", "velocity", 0.3048, "foot per second", "US"),
  U("kn", "velocity", 0.514444444444444, "knot", "other"),

  // acceleration
  U("m/s^2", "acceleration", 1, "meter per second squared"),
  U("ft/s^2", "acceleration", 0.3048, "foot per second squared", "US"),

  // force
  U("N", "force", 1, "newton"),
  U("mN", "force", 1e-3, "millinewton"),
  U("kN", "force", 1e3, "kilonewton"),
  U("lbf", "force", 4.4482216152605, "pound-force", "US"),
  U("kgf", "force", 9.80665, "kilogram-force", "other"),

  // pressure
  U("Pa", "pressure", 1, "pascal"),
  U("kPa", "pressure", 1e3, "kilopascal"),
  U("MPa", "pressure", 1e6, "megapascal"),
  U("bar", "pressure", 1e5, "bar", "other"),
  U("atm", "pressure", 101325, "standard atmosphere", "other"),
  U("psi", "pressure", 6894.757293168361, "pound per square inch", "US"),
  U("mH2O", "pressure", 9806.65, "meter of water (conventional)", "other"),

  // density
  U("kg/m^3", "density", 1, "kilogram per cubic meter"),
  U("g/cm^3", "density", 1000, "gram per cubic centimeter"),
  U("kg/L", "density", 1000, "kilogram per liter"),
  U("lb/in^3", "density", 27679.904710203122, "pound per cubic inch", "US"),
  U("lb/ft^3", "density", 16.018463373960142, "pound per cubic foot", "US"),

  // energy
  U("J", "energy", 1, "joule"),
  U("kJ", "energy", 1e3, "kilojoule"),
  U("Wh", "energy", 3600, "watt-hour"),
  U("mWh", "energy", 3.6, "milliwatt-hour"),
  U("kWh", "energy", 3.6e6, "kilowatt-hour"),

  // power
  U("W", "power", 1, "watt"),
  U("mW", "power", 1e-3, "milliwatt"),
  U("kW", "power", 1e3, "kilowatt"),
  U("hp", "power", 745.6998715822702, "mechanical horsepower", "US"),

  // torque
  U("N*m", "torque", 1, "newton meter"),
  U("N*mm", "torque", 1e-3, "newton millimeter"),
  U("mN*m", "torque", 1e-3, "millinewton meter"),
  U("kg*cm", "torque", 0.0980665, "kilogram-force centimeter", "other"),
  U("oz*in", "torque", 0.00706155183333, "ounce-force inch", "US"),
  U("lbf*in", "torque", 0.1129848290276167, "pound-force inch", "US"),

  // angle
  U("rad", "angle", 1, "radian"),
  U("deg", "angle", Math.PI / 180, "degree", "other"),

  // electrical
  U("A", "current", 1, "ampere"),
  U("mA", "current", 1e-3, "milliampere"),
  U("V", "voltage", 1, "volt"),
  U("mV", "voltage", 1e-3, "millivolt"),
  U("C", "charge", 1, "coulomb"),
  U("Ah", "charge", 3600, "ampere-hour"),
  U("mAh", "charge", 3.6, "milliampere-hour"),

  // temperature (offset units)
  U("K", "temperature", 1, "kelvin"),
  U("degC", "temperature", 1, "degree Celsius", "SI", 273.15),
  U("degF", "temperature", 5 / 9, "degree Fahrenheit", "US", 255.372222222222),

  // misc
  U("Hz", "frequency", 1, "hertz"),
  U("kHz", "frequency", 1e3, "kilohertz"),
  U("rad/s", "angularVelocity", 1, "radian per second"),
  U("rpm", "angularVelocity", (2 * Math.PI) / 60, "revolution per minute", "other"),
  U("USD", "currency", 1, "US dollar", "other"),
  U("Pa*s", "dynamicViscosity", 1, "pascal second"),
  U("mPa*s", "dynamicViscosity", 1e-3, "millipascal second"),
  U("cP", "dynamicViscosity", 1e-3, "centipoise", "other"),
  U("m^2/s", "kinematicViscosity", 1, "square meter per second"),
  U("mm^2/s", "kinematicViscosity", 1e-6, "square millimeter per second"),
  U("cSt", "kinematicViscosity", 1e-6, "centistokes", "other"),
];

export const UNITS: Record<string, UnitDef> = Object.fromEntries(
  UNIT_LIST.map((u) => [u.symbol, u]),
);

/** Aliases the UI or CSV importers may encounter. */
const ALIASES: Record<string, string> = {
  meter: "m",
  metre: "m",
  meters: "m",
  millimeter: "mm",
  millimetre: "mm",
  centimeter: "cm",
  inch: "in",
  inches: "in",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  pound: "lb",
  lbm: "lb",
  litre: "L",
  liter: "L",
  l: "L",
  ml: "mL",
  "ml.": "mL",
  cc: "cc",
  "cm3": "cm^3",
  "m3": "m^3",
  "m2": "m^2",
  "cm2": "cm^2",
  "mm2": "mm^2",
  "in3": "in^3",
  "in2": "in^2",
  degrees: "deg",
  degree: "deg",
  "°": "deg",
  "°C": "degC",
  "°F": "degF",
  C_deg: "degC",
  second: "s",
  seconds: "s",
  sec: "s",
  minute: "min",
  minutes: "min",
  hour: "h",
  hours: "h",
  hr: "h",
  newton: "N",
  "N-m": "N*m",
  Nm: "N*m",
  "kg-cm": "kg*cm",
  kgcm: "kg*cm",
  "oz-in": "oz*in",
  ozin: "oz*in",
  "lb-in": "lbf*in",
  volt: "V",
  volts: "V",
  amp: "A",
  amps: "A",
  ampere: "A",
  watt: "W",
  watts: "W",
  joule: "J",
  joules: "J",
  percent: "%",
  pct: "%",
  none: "-",
  unitless: "-",
  "": "-",
};

export function resolveUnit(symbol: string): UnitDef | undefined {
  if (UNITS[symbol]) return UNITS[symbol];
  const trimmed = symbol.trim();
  if (UNITS[trimmed]) return UNITS[trimmed];
  const alias = ALIASES[trimmed] ?? ALIASES[trimmed.toLowerCase()];
  return alias ? UNITS[alias] : undefined;
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitError";
  }
}

export function dimensionOf(symbol: string): Dimension {
  const u = resolveUnit(symbol);
  if (!u) throw new UnitError(`Unknown unit "${symbol}"`);
  return u.dimension;
}

/** Convert a numeric value between two units of the same dimension. */
export function convert(value: number, from: string, to: string): number {
  const a = resolveUnit(from);
  const b = resolveUnit(to);
  if (!a) throw new UnitError(`Unknown source unit "${from}"`);
  if (!b) throw new UnitError(`Unknown target unit "${to}"`);
  if (a.dimension !== b.dimension) {
    throw new UnitError(
      `Cannot convert ${from} (${a.dimension}) to ${to} (${b.dimension}) — dimensions differ`,
    );
  }
  if (!Number.isFinite(value)) throw new UnitError(`Value is not finite: ${value}`);
  const si = value * a.factor + (a.offset ?? 0);
  return (si - (b.offset ?? 0)) / b.factor;
}

/** Convert a value to the SI base unit of its dimension. */
export function toSI(value: number, from: string): number {
  const a = resolveUnit(from);
  if (!a) throw new UnitError(`Unknown unit "${from}"`);
  return convert(value, a.symbol, BASE_UNIT[a.dimension]);
}

/** Convert an SI-base value into a display unit. */
export function fromSI(valueSI: number, to: string): number {
  const b = resolveUnit(to);
  if (!b) throw new UnitError(`Unknown unit "${to}"`);
  return convert(valueSI, BASE_UNIT[b.dimension], b.symbol);
}

/** Units offered in the UI for a dimension, SI first. */
export function unitsFor(dimension: Dimension): UnitDef[] {
  return UNIT_LIST.filter((u) => u.dimension === dimension).sort((a, b) => {
    const rank = (x: UnitDef) => (x.system === "SI" ? 0 : x.system === "other" ? 1 : 2);
    return rank(a) - rank(b);
  });
}

/* ------------------------------------------------------------------ */
/* Quantity                                                            */
/* ------------------------------------------------------------------ */

/**
 * A numeric value with an explicit unit and provenance.
 *
 * `provenance` is central to the application's honesty guarantees: every
 * number displayed to the user is tagged with where it came from.
 */
export type Provenance =
  | "measured" // user measured it physically
  | "user" // user typed it in
  | "cad" // derived from an uploaded geometry file
  | "calculated" // produced by the calculation engine
  | "assumed" // placeholder chosen because data is missing
  | "reference" // from the cited reference library
  | "ai"; // proposed by the assistant, not yet accepted

export interface Quantity {
  value: number;
  unit: string;
  provenance?: Provenance;
  /** Absolute standard uncertainty, in the same unit as `value`. */
  uncertainty?: number;
  /** Free-text note about how the value was obtained. */
  source?: string;
}

export function qty(
  value: number,
  unit: string,
  provenance: Provenance = "calculated",
  extra?: { uncertainty?: number; source?: string },
): Quantity {
  return { value, unit, provenance, ...extra };
}

export function qtyToSI(q: Quantity): number {
  return toSI(q.value, q.unit);
}

export function qtyIn(q: Quantity, unit: string): Quantity {
  return {
    ...q,
    value: convert(q.value, q.unit, unit),
    uncertainty:
      q.uncertainty === undefined
        ? undefined
        : Math.abs(convert(q.uncertainty, q.unit, unit) - convert(0, q.unit, unit)),
    unit,
  };
}

/* ------------------------------------------------------------------ */
/* Formatting / significant figures                                    */
/* ------------------------------------------------------------------ */

/** Round to N significant figures (N >= 1). */
export function sigFigs(value: number, figures: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const n = Math.max(1, Math.min(15, Math.round(figures)));
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const power = n - 1 - magnitude;
  const factor = Math.pow(10, power);
  return Math.round(value * factor) / factor;
}

/**
 * Format a number for display, keeping `figures` significant digits and
 * switching to exponential notation outside a readable range.
 */
export function formatNumber(value: number, figures = 4): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : Number.isNaN(value) ? "—" : "-∞";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) {
    return value.toExponential(Math.max(0, figures - 1)).replace("e", "e");
  }
  const rounded = sigFigs(value, figures);
  const magnitude = Math.floor(Math.log10(Math.abs(rounded)));
  const decimals = Math.max(0, Math.min(10, figures - 1 - magnitude));
  return rounded.toFixed(decimals);
}

/**
 * Display form of a unit symbol: superscript exponents and a middle dot for
 * products. The canonical ASCII symbol (`cm^3`, `N*m`) remains the stored and
 * parsed form; this is presentation only.
 */
const SUPERSCRIPT: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "-": "⁻" };

export function prettyUnit(symbol: string): string {
  if (!symbol || symbol === "-") return "";
  return symbol
    .replace(/\^(-?\d+)/g, (_, digits: string) => [...digits].map((d) => SUPERSCRIPT[d] ?? d).join(""))
    .replace(/\*/g, "·")
    .replace(/^deg$/, "°")
    .replace(/^degC$/, "°C")
    .replace(/^degF$/, "°F");
}

export function formatQty(q: Quantity | undefined | null, figures = 4): string {
  if (!q || !Number.isFinite(q.value)) return "—";
  const pretty = prettyUnit(q.unit);
  const unit = pretty ? ` ${pretty}` : "";
  const base = `${formatNumber(q.value, figures)}${unit}`;
  if (q.uncertainty !== undefined && Number.isFinite(q.uncertainty) && q.uncertainty !== 0) {
    return `${formatNumber(q.value, figures)} ± ${formatNumber(q.uncertainty, 2)}${unit}`;
  }
  return base;
}

/**
 * Number of significant figures implied by a user-typed string.
 * "0.0250" -> 3, "1200" -> 2 (trailing zeros without a decimal point are
 * treated as non-significant, the conservative convention).
 */
export function inferSigFigs(text: string): number {
  const s = text.trim().replace(/^[+-]/, "");
  if (!s) return 0;
  const [mantissa] = s.split(/[eE]/);
  if (mantissa.includes(".")) {
    const digits = mantissa.replace(".", "").replace(/^0+/, "");
    return digits.length || 1;
  }
  const stripped = mantissa.replace(/^0+/, "");
  const trimmed = stripped.replace(/0+$/, "");
  return trimmed.length || 1;
}
