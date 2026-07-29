import { qty, type Quantity } from "@/lib/units";
import { G_STANDARD } from "@/lib/reference/water";
import { err, info, requireFinite, warn, type CalcResult, type CalcWarning } from "./types";

/**
 * Archimedes buoyancy and net buoyancy.
 *
 *   F_B   = rho_water * g * V_displaced
 *   W     = m * g
 *   F_net = F_B - W          (positive = the vehicle rises)
 *
 * All inputs arrive in SI base units. The caller is responsible for
 * conversion; see @/lib/units.
 */

export interface BuoyancyInput {
  /** Displaced volume, m^3. */
  displacedVolumeSI: number;
  /** Water density, kg/m^3. */
  waterDensitySI: number;
  /** Vehicle mass in air, kg. */
  massSI: number;
  /** Gravitational acceleration, m/s^2. Defaults to standard gravity. */
  gravitySI?: number;
}

export interface BuoyancyValues extends Record<string, Quantity | undefined> {
  buoyantForce: Quantity;
  weight: Quantity;
  netBuoyantForce: Quantity;
  netBuoyantMass: Quantity;
  displacedMass: Quantity;
  averageDensity: Quantity;
  buoyancyMarginPercent: Quantity;
}

export function computeBuoyancy(input: BuoyancyInput): CalcResult<BuoyancyValues> {
  const warnings: CalcWarning[] = [];
  const g = input.gravitySI ?? G_STANDARD;

  const okVol = requireFinite(warnings, "Displaced volume", input.displacedVolumeSI, {
    min: 0,
    allowZero: true,
    field: "displacedVolumeSI",
  });
  const okRho = requireFinite(warnings, "Water density", input.waterDensitySI, {
    min: 1,
    max: 2000,
    field: "waterDensitySI",
  });
  const okMass = requireFinite(warnings, "Vehicle mass", input.massSI, {
    min: 0,
    allowZero: true,
    field: "massSI",
  });
  requireFinite(warnings, "Gravity", g, { min: 0.1, max: 30, field: "gravitySI" });

  const V = input.displacedVolumeSI;
  const rho = input.waterDensitySI;
  const m = input.massSI;

  const FB = rho * g * V;
  const W = m * g;
  const Fnet = FB - W;
  const displacedMass = rho * V;
  const netMass = displacedMass - m;
  const avgDensity = V > 0 ? m / V : NaN;
  // Margin expressed against weight: how much of the vehicle's weight the
  // net force represents.
  const marginPct = W > 0 ? (Fnet / W) * 100 : NaN;

  if (okVol && V === 0) {
    warnings.push(
      err(
        "Displaced volume is zero, so buoyant force is zero. Add component displacement volumes or a hull envelope volume before drawing any conclusion.",
        "displacedVolumeSI",
      ),
    );
  }
  if (okMass && m === 0) {
    warnings.push(err("Vehicle mass is zero. The buoyancy result is meaningless until masses are entered.", "massSI"));
  }
  if (okVol && okMass && okRho && V > 0 && m > 0) {
    const relative = Math.abs(Fnet) / Math.max(W, 1e-12);
    if (relative < 0.005) {
      warnings.push(
        info(
          `Net buoyancy is within 0.5% of vehicle weight (${(relative * 100).toFixed(2)}%). This is nominally "neutral", but a mass/volume budget built from estimates is rarely accurate to better than a few percent — confirm with a static float test before relying on it.`,
        ),
      );
    }
    if (avgDensity > 0 && (avgDensity < 200 || avgDensity > 12000)) {
      warnings.push(
        warn(
          `Average vehicle density of ${avgDensity.toFixed(0)} kg/m^3 is outside the range expected for a small glider (roughly 200-12000 kg/m^3). Check for a unit error or a double-counted volume.`,
        ),
      );
    }
  }

  const steps = [
    {
      label: "Buoyant force (Archimedes)",
      equation: "F_B = rho_water * g * V_displaced",
      substitution: `F_B = ${rho.toPrecision(6)} kg/m^3 * ${g} m/s^2 * ${V.toExponential(4)} m^3`,
      result: `F_B = ${FB.toPrecision(5)} N`,
    },
    {
      label: "Weight",
      equation: "W = m * g",
      substitution: `W = ${m.toPrecision(5)} kg * ${g} m/s^2`,
      result: `W = ${W.toPrecision(5)} N`,
    },
    {
      label: "Net buoyant force",
      equation: "F_net = F_B - W",
      substitution: `F_net = ${FB.toPrecision(5)} N - ${W.toPrecision(5)} N`,
      result: `F_net = ${Fnet.toPrecision(5)} N (${Fnet >= 0 ? "positive: tends to rise" : "negative: tends to sink"})`,
    },
    {
      label: "Net buoyancy expressed as mass",
      equation: "m_net = rho_water * V_displaced - m",
      substitution: `m_net = ${displacedMass.toPrecision(5)} kg - ${m.toPrecision(5)} kg`,
      result: `m_net = ${netMass.toPrecision(5)} kg  (the mass you would add or remove to reach neutral)`,
      note: "This is the practical form: it tells you how many grams of ballast to add or remove.",
    },
    {
      label: "Average vehicle density",
      equation: "rho_avg = m / V_displaced",
      substitution: `rho_avg = ${m.toPrecision(5)} kg / ${V.toExponential(4)} m^3`,
      result: `rho_avg = ${Number.isFinite(avgDensity) ? avgDensity.toPrecision(5) : "—"} kg/m^3`,
      note: "Neutral buoyancy corresponds to rho_avg equal to the water density.",
    },
  ];

  return {
    id: "buoyancy.net",
    title: "Static buoyancy",
    values: {
      buoyantForce: qty(FB, "N"),
      weight: qty(W, "N"),
      netBuoyantForce: qty(Fnet, "N"),
      netBuoyantMass: qty(netMass, "kg"),
      displacedMass: qty(displacedMass, "kg"),
      averageDensity: qty(avgDensity, "kg/m^3"),
      buoyancyMarginPercent: qty(marginPct, "%"),
    },
    steps,
    equations: ["F_B = rho*g*V", "W = m*g", "F_net = F_B - W"],
    assumptions: [
      {
        text: "The vehicle is fully submerged, so the whole displaced volume is counted.",
        basis: "Standard assumption for a glider in its dive/climb phase; it is NOT valid while the vehicle is floating at the surface.",
      },
      {
        text: `Gravitational acceleration g = ${g} m/s^2.`,
        basis: g === G_STANDARD ? "Standard gravity, exact by SI definition." : "User-entered value.",
      },
      {
        text: "Water density is uniform over the vehicle and independent of depth.",
        basis: "Compressibility over a few tens of metres changes density by well under 0.1%; hull and foam compression are usually larger effects and are not modelled here.",
      },
    ],
    warnings,
    inputs: { ...input, gravitySI: g },
    confidence: "high",
    limitations: [
      "This is exact arithmetic on the numbers supplied. Its accuracy is entirely governed by how well the displaced volume and mass are known.",
      "Hull compression, foam water absorption, trapped air and surface tension at launch are not modelled.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Ballast solver                                                      */
/* ------------------------------------------------------------------ */

export interface BallastSolution {
  /** Mass to add (positive) or remove (negative) to reach neutral, kg. */
  massChangeSI: number;
  /** Displacement volume to add (positive) or remove, m^3, at fixed mass. */
  volumeChangeSI: number;
  /** Mass of a lead ballast of given density that would achieve it. */
  warnings: CalcWarning[];
}

/**
 * Two independent routes to neutral buoyancy: change mass, or change
 * displacement. Both are reported because they have very different
 * consequences for the vehicle (a heavier vehicle needs more buoyancy
 * authority; a bigger vehicle has more drag).
 */
export function solveForNeutral(input: BuoyancyInput): BallastSolution {
  const warnings: CalcWarning[] = [];
  const g = input.gravitySI ?? G_STANDARD;
  const displacedMass = input.waterDensitySI * input.displacedVolumeSI;
  const massChange = displacedMass - input.massSI; // add this much mass
  const volumeChange = input.massSI / input.waterDensitySI - input.displacedVolumeSI;

  if (!Number.isFinite(massChange)) {
    warnings.push(err("Cannot solve for neutral buoyancy: inputs are incomplete."));
  } else if (Math.abs(massChange) < 1e-6) {
    warnings.push(info("The vehicle is already neutral to within 1 mg by this budget."));
  }
  if (massChange < 0) {
    warnings.push(
      info(
        `The vehicle is ${Math.abs(massChange * 1000).toFixed(1)} g too heavy. Removing mass or adding displacement (e.g. syntactic foam) both work, but adding foam increases drag and required buoyancy authority.`,
      ),
    );
  }
  void g;
  return { massChangeSI: massChange, volumeChangeSI: volumeChange, warnings };
}
