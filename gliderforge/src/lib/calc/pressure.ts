import { qty, type Quantity } from "@/lib/units";
import { G_STANDARD } from "@/lib/reference/water";
import { err, info, requireFinite, warn, type CalcResult, type CalcWarning } from "./types";

/**
 * PRELIMINARY pressure and structural checks.
 *
 * Everything in this file is a closed-form, first-pass check of the kind used
 * to size a concept before analysis. None of it is finite-element analysis,
 * none of it replaces a proof test, and every function reports the conditions
 * under which its formula stops being valid.
 */

export const NOT_FEA_NOTICE =
  "This is a closed-form preliminary check, NOT a finite-element analysis. It does not capture stress concentrations, geometric imperfections, weld/bond lines, creep, fatigue, or the real behaviour of seals and joints. A pressure housing must be proof-tested before it carries anything you care about.";

/* ------------------------------------------------------------------ */
/* Hydrostatic pressure                                                */
/* ------------------------------------------------------------------ */

export interface HydrostaticInput {
  depthSI: number;
  waterDensitySI: number;
  gravitySI?: number;
  surfacePressureSI?: number;
}

export function hydrostaticPressure(
  input: HydrostaticInput,
): CalcResult<{ absolute: Quantity; gauge: Quantity; headOfWater: Quantity }> {
  const warnings: CalcWarning[] = [];
  const g = input.gravitySI ?? G_STANDARD;
  const p0 = input.surfacePressureSI ?? 101325;
  requireFinite(warnings, "Depth", input.depthSI, { min: 0, allowZero: true, field: "depthSI" });
  requireFinite(warnings, "Water density", input.waterDensitySI, { min: 1, max: 2000, field: "waterDensitySI" });

  const gauge = input.waterDensitySI * g * input.depthSI;
  const absolute = p0 + gauge;

  if (input.depthSI > 200) {
    warnings.push(
      info(
        "Depths beyond a couple of hundred metres put this well outside the laboratory-glider regime this tool was built for; the material and seal guidance here is not appropriate for that class of vehicle.",
      ),
    );
  }

  return {
    id: "pressure.hydrostatic",
    title: "Hydrostatic pressure",
    values: {
      absolute: qty(absolute, "Pa"),
      gauge: qty(gauge, "Pa"),
      headOfWater: qty(input.depthSI, "m"),
    },
    steps: [
      {
        label: "Gauge pressure",
        equation: "P_gauge = rho * g * h",
        substitution: `P = ${input.waterDensitySI.toFixed(1)} kg/m^3 * ${g} m/s^2 * ${input.depthSI} m`,
        result: `P_gauge = ${(gauge / 1000).toPrecision(5)} kPa = ${(gauge / 1e5).toPrecision(4)} bar`,
      },
      {
        label: "Absolute pressure",
        equation: "P_abs = P_surface + P_gauge",
        substitution: `P_abs = ${(p0 / 1000).toFixed(3)} kPa + ${(gauge / 1000).toPrecision(5)} kPa`,
        result: `P_abs = ${(absolute / 1000).toPrecision(5)} kPa`,
      },
      {
        label: "Rule of thumb",
        equation: "roughly 1 bar (100 kPa) per 10 m of fresh water",
        result: `${(gauge / 1e5).toFixed(2)} bar gauge at ${input.depthSI} m`,
      },
    ],
    equations: ["P = P_0 + rho*g*h"],
    assumptions: [
      { text: "Water density is uniform with depth.", basis: "Adequate for shallow fresh or coastal water." },
      { text: `Surface pressure ${(p0 / 1000).toFixed(2)} kPa.`, basis: input.surfacePressureSI ? "User-entered." : "Standard atmosphere, 101.325 kPa." },
      { text: "Static water: no dynamic pressure from vehicle motion or waves.", basis: "Dynamic pressure at glider speeds (<1 m/s) is under 500 Pa, negligible next to depth pressure." },
    ],
    warnings,
    inputs: { ...input, gravitySI: g, surfacePressureSI: p0 },
    confidence: "high",
  };
}

/* ------------------------------------------------------------------ */
/* Cylindrical pressure housing                                        */
/* ------------------------------------------------------------------ */

export interface CylinderInput {
  /** Outside diameter, m. */
  outerDiameterSI: number;
  /** Wall thickness, m. */
  wallThicknessSI: number;
  /** Unsupported length between stiffeners/end caps, m. */
  lengthSI: number;
  /** External gauge pressure, Pa. */
  externalPressureSI: number;
  /** Young's modulus, Pa. */
  youngsModulusSI: number;
  poissonsRatio: number;
  /** Compressive yield / allowable stress, Pa. */
  yieldStrengthSI: number;
  /** Required factor of safety. */
  safetyFactor: number;
  materialProvenance: "user" | "reference" | "assumed";
}

export interface CylinderValues extends Record<string, Quantity | undefined> {
  hoopStress: Quantity;
  axialStress: Quantity;
  yieldMargin: Quantity;
  bucklingPressureLong: Quantity;
  bucklingPressureFiniteLength?: Quantity;
  governingCollapsePressure: Quantity;
  bucklingMargin: Quantity;
  thicknessRatio: Quantity;
}

/**
 * External-pressure check for a thin-walled tube.
 *
 * Membrane stress:      sigma_hoop = P * R_mean / t     (compressive)
 * Long-tube buckling:   P_cr = 2E/(1-nu^2) * (t/D)^3
 *                       [Timoshenko & Gere, Theory of Elastic Stability,
 *                        long circular tube under uniform external pressure]
 * Finite length:        Windenburg & Trilling (1934) approximation
 *                       P_cr = 2.42 E (t/D)^2.5
 *                              / [ (1-nu^2)^0.75 ( L/D - 0.45 sqrt(t/D) ) ]
 *
 * For a thin tube under EXTERNAL pressure, elastic buckling almost always
 * governs long before the material yields. That is the single most important
 * thing this function exists to point out.
 */
export function cylinderExternalPressure(input: CylinderInput): CalcResult<CylinderValues> {
  const warnings: CalcWarning[] = [];
  const D = input.outerDiameterSI;
  const t = input.wallThicknessSI;
  const L = input.lengthSI;
  const P = input.externalPressureSI;
  const E = input.youngsModulusSI;
  const nu = input.poissonsRatio;

  requireFinite(warnings, "Outer diameter", D, { min: 1e-3, field: "outerDiameterSI" });
  requireFinite(warnings, "Wall thickness", t, { min: 1e-5, field: "wallThicknessSI" });
  requireFinite(warnings, "Length", L, { min: 1e-3, field: "lengthSI" });
  requireFinite(warnings, "External pressure", P, { min: 0, allowZero: true, field: "externalPressureSI" });
  requireFinite(warnings, "Young's modulus", E, { min: 1e6, field: "youngsModulusSI" });
  requireFinite(warnings, "Poisson's ratio", nu, { min: 0, max: 0.5, field: "poissonsRatio" });

  if (t >= D / 2) {
    warnings.push(err("Wall thickness is at least the outer radius — the tube has no bore. Check the inputs."));
  }

  const Rm = (D - t) / 2;
  const tOverD = t / D;
  const hoop = (P * Rm) / t;
  const axial = hoop / 2; // capped tube, external pressure on the end caps

  if (tOverD > 0.1) {
    warnings.push(
      warn(
        `t/D = ${tOverD.toFixed(3)} exceeds 0.1, so the thin-wall membrane formula is no longer accurate. Use a thick-wall (Lame) solution, and note that the buckling formulas below are also derived for thin shells.`,
      ),
    );
  }

  const bucklingLong = ((2 * E) / (1 - nu * nu)) * Math.pow(tOverD, 3);
  const lOverD = L / D;
  let bucklingFinite: number | undefined;
  const wtDenominator = lOverD - 0.45 * Math.sqrt(tOverD);
  if (wtDenominator > 0) {
    bucklingFinite =
      (2.42 * E * Math.pow(tOverD, 2.5)) / (Math.pow(1 - nu * nu, 0.75) * wtDenominator);
  } else {
    warnings.push(
      info(
        "The tube is too short relative to its diameter for the Windenburg-Trilling finite-length formula; only the long-tube result is reported, which is conservative for a short tube.",
      ),
    );
  }

  const governing =
    bucklingFinite !== undefined ? Math.min(bucklingLong, bucklingFinite) : bucklingLong;
  const bucklingMargin = P > 0 ? governing / P : Infinity;
  const yieldMargin = hoop > 0 ? input.yieldStrengthSI / hoop : Infinity;

  if (bucklingMargin < input.safetyFactor) {
    warnings.push(
      err(
        `Predicted elastic collapse pressure (${(governing / 1e5).toFixed(2)} bar) gives a margin of only ${bucklingMargin.toFixed(2)} against the ${(P / 1e5).toFixed(2)} bar service pressure, below the required factor of safety of ${input.safetyFactor}. Increase wall thickness, shorten the unsupported length with stiffening rings, or reduce depth.`,
      ),
    );
  }
  if (yieldMargin < input.safetyFactor) {
    warnings.push(
      err(
        `Membrane hoop stress ${(hoop / 1e6).toFixed(1)} MPa gives a yield margin of ${yieldMargin.toFixed(2)}, below the required factor of safety of ${input.safetyFactor}.`,
      ),
    );
  }
  if (bucklingMargin < yieldMargin) {
    warnings.push(
      info(
        "Elastic buckling governs, not yielding — as it usually does for a thin tube under external pressure. Making the material stronger will not help; making the wall thicker or the unsupported span shorter will.",
      ),
    );
  }
  warnings.push(
    warn(
      "The buckling formulas above assume a PERFECT circular cylinder. Real tubes are slightly out-of-round, and shell buckling is notoriously imperfection-sensitive: measured collapse pressures of 50-70% of the theoretical value are common. Apply a knockdown factor and proof-test.",
    ),
  );
  if (input.materialProvenance !== "user") {
    warnings.push(
      warn(
        `Material properties are ${input.materialProvenance === "reference" ? "unverified library reference values" : "assumed"}. A structural pass/fail conclusion must not rest on them — enter datasheet values for the actual stock you bought.`,
      ),
    );
  }

  return {
    id: "pressure.cylinder",
    title: "Cylindrical pressure housing under external pressure",
    values: {
      hoopStress: qty(hoop, "Pa"),
      axialStress: qty(axial, "Pa"),
      yieldMargin: qty(yieldMargin, "-"),
      bucklingPressureLong: qty(bucklingLong, "Pa"),
      bucklingPressureFiniteLength: bucklingFinite !== undefined ? qty(bucklingFinite, "Pa") : undefined,
      governingCollapsePressure: qty(governing, "Pa"),
      bucklingMargin: qty(bucklingMargin, "-"),
      thicknessRatio: qty(tOverD, "-"),
    },
    steps: [
      {
        label: "Membrane hoop stress",
        equation: "sigma_hoop = P * R_mean / t",
        substitution: `= ${(P / 1000).toFixed(1)} kPa * ${(Rm * 1000).toFixed(2)} mm / ${(t * 1000).toFixed(2)} mm`,
        result: `${(hoop / 1e6).toPrecision(4)} MPa (compressive)`,
      },
      {
        label: "Long-tube elastic collapse",
        equation: "P_cr = 2E / (1 - nu^2) * (t/D)^3",
        substitution: `= 2*${(E / 1e9).toFixed(1)} GPa / (1 - ${nu}^2) * (${tOverD.toFixed(4)})^3`,
        result: `${(bucklingLong / 1e5).toPrecision(4)} bar`,
        note: "Timoshenko & Gere, long circular tube under uniform external pressure.",
      },
      ...(bucklingFinite !== undefined
        ? [
            {
              label: "Finite-length elastic collapse (Windenburg-Trilling, 1934)",
              equation: "P_cr = 2.42 E (t/D)^2.5 / [ (1-nu^2)^0.75 ( L/D - 0.45 (t/D)^0.5 ) ]",
              substitution: `L/D = ${lOverD.toFixed(2)}, t/D = ${tOverD.toFixed(4)}`,
              result: `${(bucklingFinite / 1e5).toPrecision(4)} bar`,
            },
          ]
        : []),
      {
        label: "Governing collapse pressure",
        equation: "P_cr = min(long-tube, finite-length)",
        result: `${(governing / 1e5).toPrecision(4)} bar, margin ${bucklingMargin.toFixed(2)} against service pressure`,
      },
    ],
    equations: [
      "sigma_hoop = P*R_m/t",
      "P_cr,long = 2E/(1-nu^2)*(t/D)^3",
      "P_cr,WT = 2.42E(t/D)^2.5 / [(1-nu^2)^0.75 (L/D - 0.45 sqrt(t/D))]",
    ],
    assumptions: [
      { text: "Perfectly circular, uniform-thickness, isotropic tube.", basis: "Required by the closed-form buckling theory. Real out-of-roundness reduces collapse pressure substantially." },
      { text: "Ends are simply supported by the end caps.", basis: "Standard assumption in the Windenburg-Trilling fit." },
      { text: "Purely elastic behaviour up to collapse.", basis: "Valid for metals and glassy polymers at short duration; NOT valid for polymers under sustained load, which creep." },
      { text: "No stress concentrations from penetrations, O-ring grooves or fasteners.", basis: "A cable-gland hole or a groove is a stress raiser this formula cannot see." },
    ],
    warnings,
    inputs: input,
    confidence: "low",
    limitations: [NOT_FEA_NOTICE, "Imperfection sensitivity is not modelled; apply a knockdown factor from a recognised design code or from your own proof test."],
  };
}

/* ------------------------------------------------------------------ */
/* Flat circular end cap                                               */
/* ------------------------------------------------------------------ */

export interface EndCapInput {
  /** Unsupported radius of the plate, m. */
  radiusSI: number;
  thicknessSI: number;
  pressureSI: number;
  youngsModulusSI: number;
  poissonsRatio: number;
  yieldStrengthSI: number;
  edgeCondition: "clamped" | "simply-supported";
  safetyFactor: number;
}

/**
 * Uniformly loaded flat circular plate, from Roark's Formulas for Stress and
 * Strain (flat plates, Table 11.2, cases 10a/10b):
 *
 *   Clamped edge:  sigma_max = 3 q a^2 / (4 t^2)      (at the edge)
 *                  y_max     = 3 q a^4 (1-nu^2) / (16 E t^3)
 *   Simply supported:
 *                  sigma_max = 3 q a^2 (3+nu) / (8 t^2)   (at the centre)
 *                  y_max     = 3 q a^4 (1-nu)(5+nu) / (16 E t^3)
 *
 * Valid only for small deflections (y_max less than about half the thickness).
 */
export function flatEndCap(input: EndCapInput): CalcResult<{
  maxStress: Quantity;
  maxDeflection: Quantity;
  yieldMargin: Quantity;
  deflectionRatio: Quantity;
}> {
  const warnings: CalcWarning[] = [];
  const a = input.radiusSI;
  const t = input.thicknessSI;
  const q = input.pressureSI;
  const E = input.youngsModulusSI;
  const nu = input.poissonsRatio;

  requireFinite(warnings, "Plate radius", a, { min: 1e-4, field: "radiusSI" });
  requireFinite(warnings, "Plate thickness", t, { min: 1e-5, field: "thicknessSI" });
  requireFinite(warnings, "Pressure", q, { min: 0, allowZero: true, field: "pressureSI" });

  const clamped = input.edgeCondition === "clamped";
  const stress = clamped ? (3 * q * a * a) / (4 * t * t) : (3 * q * a * a * (3 + nu)) / (8 * t * t);
  const deflection = clamped
    ? (3 * q * Math.pow(a, 4) * (1 - nu * nu)) / (16 * E * Math.pow(t, 3))
    : (3 * q * Math.pow(a, 4) * (1 - nu) * (5 + nu)) / (16 * E * Math.pow(t, 3));

  const ratio = deflection / t;
  const margin = stress > 0 ? input.yieldStrengthSI / stress : Infinity;

  if (ratio > 0.5) {
    warnings.push(
      warn(
        `Predicted deflection is ${ratio.toFixed(2)} times the plate thickness. Small-deflection plate theory is only valid below about 0.5; membrane stiffening takes over and this stress result becomes unreliable (usually conservative on stress, unconservative on the edge/seal geometry).`,
      ),
    );
  }
  if (a / t < 5) {
    warnings.push(
      warn(`Radius-to-thickness ratio is ${(a / t).toFixed(1)}. Thin-plate theory assumes it is well above about 5-10; below that, transverse shear matters.`),
    );
  }
  if (margin < input.safetyFactor) {
    warnings.push(
      err(`Plate yield margin is ${margin.toFixed(2)}, below the required factor of safety of ${input.safetyFactor}.`),
    );
  }
  warnings.push(
    info(
      "End-cap deflection matters for more than stress: it can unseat an O-ring face seal or bind a moving shaft. Check the seal geometry against the deflected shape, not just the stress.",
    ),
  );

  return {
    id: "pressure.endcap",
    title: `Flat circular end cap (${input.edgeCondition})`,
    values: {
      maxStress: qty(stress, "Pa"),
      maxDeflection: qty(deflection, "m"),
      yieldMargin: qty(margin, "-"),
      deflectionRatio: qty(ratio, "-"),
    },
    steps: [
      {
        label: "Maximum bending stress",
        equation: clamped ? "sigma_max = 3 q a^2 / (4 t^2)  [at edge]" : "sigma_max = 3 q a^2 (3+nu) / (8 t^2)  [at centre]",
        substitution: `q = ${(q / 1000).toFixed(1)} kPa, a = ${(a * 1000).toFixed(1)} mm, t = ${(t * 1000).toFixed(2)} mm`,
        result: `${(stress / 1e6).toPrecision(4)} MPa`,
      },
      {
        label: "Maximum deflection",
        equation: clamped ? "y = 3 q a^4 (1-nu^2) / (16 E t^3)" : "y = 3 q a^4 (1-nu)(5+nu) / (16 E t^3)",
        result: `${(deflection * 1000).toPrecision(4)} mm (${ratio.toFixed(3)} x thickness)`,
      },
      { label: "Yield margin", equation: "n = sigma_yield / sigma_max", result: margin.toFixed(2) },
    ],
    equations: ["Roark flat circular plate, uniform load, clamped / simply supported edge"],
    assumptions: [
      { text: "Small-deflection (Kirchhoff) thin-plate theory.", basis: "Roark's Formulas for Stress and Strain, flat plates chapter." },
      { text: `Edge condition modelled as ${input.edgeCondition}.`, basis: "A bolted cap is between the two; clamped is less conservative on stress, simply supported is less conservative on deflection. Check both." },
      { text: "No hole in the plate.", basis: "Any penetration (shaft, cable gland, vent) invalidates this and raises local stress." },
    ],
    warnings,
    inputs: input,
    confidence: "low",
    limitations: [NOT_FEA_NOTICE],
  };
}

/* ------------------------------------------------------------------ */
/* Penetrations, seals, fasteners                                      */
/* ------------------------------------------------------------------ */

export interface PenetrationInput {
  /** Diameter of the hole / shaft / connector, m. */
  diameterSI: number;
  externalPressureSI: number;
  /** Number of retaining fasteners, if any. */
  fastenerCount?: number;
  /** Tensile stress area of one fastener, m^2. */
  fastenerStressAreaSI?: number;
  /** Fastener proof/yield strength, Pa. */
  fastenerStrengthSI?: number;
  safetyFactor: number;
}

export function penetrationLoad(input: PenetrationInput): CalcResult<{
  area: Quantity;
  thrust: Quantity;
  forcePerFastener?: Quantity;
  fastenerStress?: Quantity;
  fastenerMargin?: Quantity;
}> {
  const warnings: CalcWarning[] = [];
  requireFinite(warnings, "Penetration diameter", input.diameterSI, { min: 1e-4, field: "diameterSI" });
  const area = (Math.PI / 4) * input.diameterSI ** 2;
  const thrust = area * input.externalPressureSI;

  let perFastener: number | undefined;
  let stress: number | undefined;
  let margin: number | undefined;
  if (input.fastenerCount && input.fastenerCount > 0) {
    perFastener = thrust / input.fastenerCount;
    if (input.fastenerStressAreaSI && input.fastenerStressAreaSI > 0) {
      stress = perFastener / input.fastenerStressAreaSI;
      if (input.fastenerStrengthSI) {
        margin = input.fastenerStrengthSI / stress;
        if (margin < input.safetyFactor) {
          warnings.push(err(`Fastener margin ${margin.toFixed(2)} is below the required factor of safety of ${input.safetyFactor}.`));
        }
      }
    }
  }

  warnings.push(
    info(
      "External pressure pushes a penetration INWARD. The retaining feature (shoulder, circlip, bolts, potting) must react that thrust — a connector held only by friction or by a thread engaged in thin plastic is a common failure point.",
    ),
  );
  warnings.push(
    warn(
      "This computes the pressure thrust only. It does not check thread stripping, bearing stress on the housing, potting adhesion, or the seal itself.",
    ),
  );

  return {
    id: "pressure.penetration",
    title: "Hull penetration pressure thrust",
    values: {
      area: qty(area, "m^2"),
      thrust: qty(thrust, "N"),
      forcePerFastener: perFastener !== undefined ? qty(perFastener, "N") : undefined,
      fastenerStress: stress !== undefined ? qty(stress, "Pa") : undefined,
      fastenerMargin: margin !== undefined ? qty(margin, "-") : undefined,
    },
    steps: [
      { label: "Projected area", equation: "A = pi/4 * d^2", result: `${(area * 1e6).toPrecision(4)} mm^2` },
      {
        label: "Inward thrust",
        equation: "F = P * A",
        substitution: `F = ${(input.externalPressureSI / 1000).toFixed(1)} kPa * ${(area * 1e6).toPrecision(4)} mm^2`,
        result: `${thrust.toPrecision(4)} N`,
      },
    ],
    equations: ["F = P*A"],
    assumptions: [{ text: "The full external gauge pressure acts over the projected area of the penetration.", basis: "Conservative and standard for a blanked or sealed penetration." }],
    warnings,
    inputs: input,
    confidence: "medium",
    limitations: [NOT_FEA_NOTICE],
  };
}

export interface ORingGlandInput {
  /** O-ring cross-section (cord) diameter, m. */
  cordDiameterSI: number;
  /** Gland depth for a face seal, or radial gap for a radial seal, m. */
  glandDepthSI: number;
  /** Gland width, m. */
  glandWidthSI: number;
  sealType: "face" | "radial-static" | "radial-dynamic";
  /** Diametral clearance across the extrusion gap, m. */
  extrusionGapSI?: number;
  externalPressureSI: number;
}

/**
 * O-ring gland geometry check.
 *
 * The acceptance bands used here (squeeze and gland fill) are the ranges
 * published in seal-manufacturer design handbooks — the Parker O-Ring
 * Handbook ORD-5700 is the usual reference and is what the UI cites. They are
 * reproduced here as GUIDANCE BANDS, not as a specification: confirm against
 * the handbook for the seal you actually buy, because the numbers depend on
 * cord size, material and application.
 */
export function oRingGland(input: ORingGlandInput): CalcResult<{
  squeezeFraction: Quantity;
  squeezeAbsolute: Quantity;
  glandFillFraction: Quantity;
}> {
  const warnings: CalcWarning[] = [];
  const cd = input.cordDiameterSI;
  requireFinite(warnings, "Cord diameter", cd, { min: 1e-4, field: "cordDiameterSI" });
  requireFinite(warnings, "Gland depth", input.glandDepthSI, { min: 1e-5, field: "glandDepthSI" });
  requireFinite(warnings, "Gland width", input.glandWidthSI, { min: 1e-5, field: "glandWidthSI" });

  const squeezeAbs = cd - input.glandDepthSI;
  const squeeze = squeezeAbs / cd;
  const ringArea = (Math.PI / 4) * cd * cd;
  const glandArea = input.glandDepthSI * input.glandWidthSI;
  const fill = glandArea > 0 ? ringArea / glandArea : NaN;

  const bands: Record<ORingGlandInput["sealType"], [number, number]> = {
    face: [0.2, 0.3],
    "radial-static": [0.15, 0.3],
    "radial-dynamic": [0.1, 0.2],
  };
  const [lo, hi] = bands[input.sealType];

  if (squeeze < lo) {
    warnings.push(
      err(
        `Squeeze is ${(squeeze * 100).toFixed(1)}%, below the ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}% band normally quoted for a ${input.sealType} seal. Too little squeeze leaks, especially at low pressure before the ring is energised.`,
      ),
    );
  } else if (squeeze > hi) {
    warnings.push(
      warn(
        `Squeeze is ${(squeeze * 100).toFixed(1)}%, above the ${(hi * 100).toFixed(0)}% band. Over-squeeze raises friction sharply (which matters for a moving plunger) and accelerates compression set.`,
      ),
    );
  }
  if (Number.isFinite(fill)) {
    if (fill > 0.9) {
      warnings.push(
        err(
          `Gland fill is ${(fill * 100).toFixed(0)}%. Above roughly 85-90% there is no room for the ring to expand thermally or to be displaced by pressure, and the gland can hydraulically lock or the ring can be damaged.`,
        ),
      );
    } else if (fill < 0.5) {
      warnings.push(info(`Gland fill is ${(fill * 100).toFixed(0)}%; typical practice is 60-85%. A very loose gland can let the ring roll or spiral in a dynamic application.`));
    }
  }
  if (input.extrusionGapSI !== undefined && input.externalPressureSI > 5e5 && input.extrusionGapSI > 0.0002) {
    warnings.push(
      warn(
        "At pressures above a few bar an extrusion gap larger than about 0.2 mm needs either a tighter fit, a harder compound, or a back-up ring, otherwise the seal extrudes into the gap and nibbles.",
      ),
    );
  }
  warnings.push(
    info(
      "Seal design bands cited here follow seal-manufacturer design-handbook practice (e.g. the Parker O-Ring Handbook ORD-5700). Confirm against the handbook for your specific cord size and compound; this check is geometry only and says nothing about compound compatibility, surface finish or lead-in chamfers.",
    ),
  );

  return {
    id: "pressure.oring",
    title: `O-ring gland geometry (${input.sealType})`,
    values: {
      squeezeFraction: qty(squeeze, "-"),
      squeezeAbsolute: qty(squeezeAbs, "m"),
      glandFillFraction: qty(fill, "-"),
    },
    steps: [
      {
        label: "Squeeze",
        equation: "squeeze = (cord dia - gland depth) / cord dia",
        substitution: `= (${(cd * 1000).toFixed(2)} - ${(input.glandDepthSI * 1000).toFixed(2)}) / ${(cd * 1000).toFixed(2)} mm`,
        result: `${(squeeze * 100).toFixed(1)} % (target ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)} %)`,
      },
      {
        label: "Gland fill",
        equation: "fill = A_ring / (depth * width)",
        result: `${(fill * 100).toFixed(0)} % (target roughly 60-85 %)`,
      },
    ],
    equations: ["squeeze = (d_cord - h_gland)/d_cord", "fill = A_ring/A_gland"],
    assumptions: [
      { text: "Nominal dimensions; manufacturing tolerances are not stacked.", basis: "A worst-case tolerance stack can push a nominally acceptable gland outside the band." },
      { text: "Guidance bands follow seal-manufacturer design-handbook practice.", basis: "Confirm against the handbook for the specific seal purchased." },
    ],
    warnings,
    inputs: input,
    confidence: "medium",
    limitations: ["Geometry check only. Material compatibility, surface finish, temperature and chemical exposure are not evaluated."],
  };
}
