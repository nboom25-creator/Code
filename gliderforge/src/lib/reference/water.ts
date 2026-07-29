import type { CalcWarning } from "@/lib/calc/types";

/**
 * Water density and viscosity.
 *
 * Density uses the one-atmosphere International Equation of State of Seawater
 * (EOS-80), i.e. the Millero & Poisson (1981) / UNESCO (1981) polynomial.
 * It is quoted for the ranges below and is the correlation named in the UI.
 *
 *   Valid range:  temperature -2 .. 40 degC, practical salinity 0 .. 42 PSU,
 *                 pressure = 1 atm (surface).
 *
 * Pressure (depth) compressibility is NOT included. For the depths a
 * laboratory glider sees (order 1-30 m) the density increase from
 * compressibility is roughly 0.005 %/10 m, far below the uncertainty in the
 * vehicle's own displaced volume, so it is reported as an explicit assumption
 * rather than modelled.
 */

export const WATER_DENSITY_CORRELATION = {
  name: "One-atmosphere International Equation of State of Seawater (EOS-80)",
  citation:
    "Millero, F.J. & Poisson, A. (1981), 'International one-atmosphere equation of state of seawater', Deep-Sea Research 28A(6); adopted in UNESCO Technical Papers in Marine Science 36 (1981).",
  validTemperatureC: [-2, 40] as [number, number],
  validSalinityPSU: [0, 42] as [number, number],
  validPressure: "1 atm (surface); compressibility with depth not included.",
  statedAccuracy:
    "The published fit reproduces the underlying measurements to about 0.004 kg/m^3 (standard error) inside its stated range.",
};

/** Standard gravitational acceleration, exact by definition (CGPM 1901, SI). */
export const G_STANDARD = 9.80665; // m/s^2

export interface WaterInput {
  temperatureC: number;
  /** Practical salinity, PSU. 0 = fresh water. Typical open ocean ~35. */
  salinityPSU: number;
}

export interface WaterDensityResult {
  densitySI: number; // kg/m^3
  warnings: CalcWarning[];
  extrapolated: boolean;
  equation: string;
  correlation: typeof WATER_DENSITY_CORRELATION;
}

/** Density of pure (salinity 0) water, EOS-80 pure-water term. */
export function pureWaterDensity(tC: number): number {
  const t = tC;
  return (
    999.842594 +
    6.793952e-2 * t -
    9.09529e-3 * t ** 2 +
    1.001685e-4 * t ** 3 -
    1.120083e-6 * t ** 4 +
    6.536332e-9 * t ** 5
  );
}

export function waterDensity(input: WaterInput): WaterDensityResult {
  const warnings: CalcWarning[] = [];
  const t = input.temperatureC;
  const S = input.salinityPSU;
  let extrapolated = false;

  const [tMin, tMax] = WATER_DENSITY_CORRELATION.validTemperatureC;
  const [sMin, sMax] = WATER_DENSITY_CORRELATION.validSalinityPSU;

  if (!Number.isFinite(t) || !Number.isFinite(S)) {
    warnings.push({
      severity: "error",
      message: "Water temperature and salinity must both be finite numbers.",
    });
    return {
      densitySI: NaN,
      warnings,
      extrapolated: true,
      equation: "EOS-80",
      correlation: WATER_DENSITY_CORRELATION,
    };
  }
  if (S < 0) {
    warnings.push({ severity: "error", message: "Salinity cannot be negative.", field: "salinity" });
    return {
      densitySI: NaN,
      warnings,
      extrapolated: true,
      equation: "EOS-80",
      correlation: WATER_DENSITY_CORRELATION,
    };
  }
  if (t < tMin || t > tMax) {
    extrapolated = true;
    warnings.push({
      severity: "warning",
      message: `Temperature ${t} degC is outside the validated range ${tMin}..${tMax} degC of ${WATER_DENSITY_CORRELATION.name}. The value returned is an extrapolation and should not be relied on.`,
      field: "temperature",
    });
  }
  if (S > sMax) {
    extrapolated = true;
    warnings.push({
      severity: "warning",
      message: `Salinity ${S} PSU is outside the validated range ${sMin}..${sMax} PSU. The value returned is an extrapolation.`,
      field: "salinity",
    });
  }

  const rhoW = pureWaterDensity(t);
  const A =
    0.824493 - 4.0899e-3 * t + 7.6438e-5 * t ** 2 - 8.2467e-7 * t ** 3 + 5.3875e-9 * t ** 4;
  const B = -5.72466e-3 + 1.0227e-4 * t - 1.6546e-6 * t ** 2;
  const C = 4.8314e-4;
  const density = rhoW + A * S + B * Math.pow(S, 1.5) + C * S * S;

  return {
    densitySI: density,
    warnings,
    extrapolated,
    equation: "rho(S,T,0) = rho_w(T) + A(T)*S + B(T)*S^1.5 + C*S^2   [EOS-80]",
    correlation: WATER_DENSITY_CORRELATION,
  };
}

/**
 * Dynamic viscosity of pure water, Vogel-type fit.
 *
 * mu(T) = 2.414e-5 * 10^(247.8 / (T - 140))   [Pa*s, T in kelvin]
 *
 * This is the widely reproduced empirical correlation given in Seeton, C.J.
 * (2006), "Viscosity-temperature correlation for liquids", Tribology Letters
 * 22, attributed there to the classic Vogel form. Quoted useful range roughly
 * 0-100 degC for pure water, agreeing with tabulated values to within a few
 * percent. Salinity raises viscosity by roughly 5-8% at S = 35 PSU; that
 * correction is NOT applied here and is reported as an assumption.
 */
export function waterDynamicViscosity(tC: number): { valueSI: number; warnings: CalcWarning[]; equation: string; citation: string } {
  const warnings: CalcWarning[] = [];
  if (tC < 0 || tC > 100) {
    warnings.push({
      severity: "warning",
      message: `Viscosity correlation is quoted for roughly 0..100 degC; ${tC} degC is outside that range.`,
    });
  }
  const T = tC + 273.15;
  const value = 2.414e-5 * Math.pow(10, 247.8 / (T - 140));
  return {
    valueSI: value,
    warnings,
    equation: "mu = 2.414e-5 * 10^(247.8 / (T_K - 140))  [Pa*s]",
    citation:
      "Vogel-type empirical fit as reproduced in Seeton, C.J. (2006), Tribology Letters 22, 67-78. Pure water; no salinity correction applied.",
  };
}

/** Kinematic viscosity nu = mu / rho. */
export function waterKinematicViscosity(tC: number, densitySI: number): number {
  return waterDynamicViscosity(tC).valueSI / densitySI;
}

export const WATER_PRESETS = [
  {
    id: "pool-fresh",
    label: "Indoor pool / fresh water, 25 degC",
    temperatureC: 25,
    salinityPSU: 0,
    note: "Typical heated indoor test tank. Confirm with a thermometer before a test run.",
  },
  {
    id: "tank-fresh",
    label: "Lab tank / tap water, 20 degC",
    temperatureC: 20,
    salinityPSU: 0,
    note: "Room-temperature tap water.",
  },
  {
    id: "lake",
    label: "Lake, 15 degC",
    temperatureC: 15,
    salinityPSU: 0,
    note: "Freshwater lake near the surface in temperate conditions.",
  },
  {
    id: "ocean",
    label: "Coastal sea water, 15 degC, 35 PSU",
    temperatureC: 15,
    salinityPSU: 35,
    note: "Nominal open-ocean salinity. Measure locally if buoyancy margin is tight.",
  },
] as const;
