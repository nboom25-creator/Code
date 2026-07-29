import { qty, type Quantity } from "@/lib/units";
import { waterDynamicViscosity } from "@/lib/reference/water";
import { err, info, requireFinite, warn, type CalcResult, type CalcWarning } from "./types";

/**
 * Preliminary hydrodynamics for a small underwater glider.
 *
 * Four modelling levels are offered, and the level in use is always shown:
 *
 *   1 "coefficient"  - the user supplies C_L and C_D directly.
 *   2 "buildup"      - flat-plate friction (ITTC-57) x form factor, plus wing
 *                      profile and induced drag. Standard preliminary-design
 *                      practice; expect tens of percent of error.
 *   3 "experimental" - coefficients measured in a tow test.
 *   4 "calibrated"   - a buildup model scaled by a factor fitted to test data,
 *                      with the original prediction preserved for comparison.
 *
 * No coefficient is ever chosen silently. Where a default is offered it is
 * labelled as an initial estimate with its basis.
 */

export type HydroModelLevel = "coefficient" | "buildup" | "experimental" | "calibrated";

export const COEFFICIENT_DEFAULTS = {
  hullFormFactorNote:
    "Form factor from Hoerner's body-of-revolution correlation (1+k) = 1 + 1.5*(d/L)^1.5 + 7*(d/L)^3, S.F. Hoerner, 'Fluid-Dynamic Drag' (1965). It accounts for the pressure drag of a streamlined body of revolution relative to a flat plate of equal wetted area.",
  frictionLineNote:
    "Skin-friction coefficient from the ITTC-1957 model-ship correlation line, C_f = 0.075 / (log10(Re) - 2)^2, adopted by the International Towing Tank Conference. It is a correlation line rather than a pure friction law and is normally applied for Re above about 1e5.",
  laminarNote:
    "Blasius laminar flat-plate solution, C_f = 1.328 / sqrt(Re). Applies below transition, roughly Re < 5e5 on a smooth surface.",
  ovalNote:
    "A blunt, non-streamlined shape does not obey these correlations. If the vehicle is a bare tube with square ends, expect the buildup to underestimate drag substantially.",
};

/* ------------------------------------------------------------------ */
/* Reynolds number                                                     */
/* ------------------------------------------------------------------ */

export interface ReynoldsInput {
  velocitySI: number;
  characteristicLengthSI: number;
  densitySI: number;
  /** Dynamic viscosity, Pa*s. If omitted, computed from temperature. */
  dynamicViscositySI?: number;
  temperatureC?: number;
}

export function reynoldsNumber(input: ReynoldsInput): CalcResult<{
  reynolds: Quantity;
  dynamicViscosity: Quantity;
  kinematicViscosity: Quantity;
}> {
  const warnings: CalcWarning[] = [];
  requireFinite(warnings, "Velocity", input.velocitySI, { min: 0, allowZero: true, field: "velocitySI" });
  requireFinite(warnings, "Characteristic length", input.characteristicLengthSI, { min: 1e-4, field: "characteristicLengthSI" });
  requireFinite(warnings, "Density", input.densitySI, { min: 1, field: "densitySI" });

  let mu = input.dynamicViscositySI;
  let viscositySource = "user-entered";
  if (mu === undefined) {
    const t = input.temperatureC ?? 20;
    const v = waterDynamicViscosity(t);
    mu = v.valueSI;
    warnings.push(...v.warnings);
    viscositySource = `computed from ${t} degC via ${v.equation}`;
  }
  const nu = mu / input.densitySI;
  const Re = (input.densitySI * input.velocitySI * input.characteristicLengthSI) / mu;

  if (Re > 0 && Re < 5e5) {
    warnings.push(
      info(
        `Re = ${Re.toExponential(2)} is below the classical flat-plate transition value of about 5e5, so a substantial part of the boundary layer may be laminar. Surface roughness, joints and appendages usually trip it earlier on a real vehicle, which is why the ITTC line is normally still used.`,
      ),
    );
  }

  return {
    id: "hydro.reynolds",
    title: "Reynolds number",
    values: {
      reynolds: qty(Re, "-"),
      dynamicViscosity: qty(mu, "Pa*s"),
      kinematicViscosity: qty(nu, "m^2/s"),
    },
    steps: [
      {
        label: "Reynolds number",
        equation: "Re = rho * V * L / mu = V * L / nu",
        substitution: `Re = ${input.densitySI.toFixed(1)} * ${input.velocitySI.toPrecision(4)} * ${input.characteristicLengthSI.toPrecision(4)} / ${mu.toExponential(4)}`,
        result: `Re = ${Re.toExponential(4)}`,
      },
      { label: "Viscosity used", equation: "mu", result: `${mu.toExponential(4)} Pa*s (${viscositySource})` },
    ],
    equations: ["Re = rho*V*L/mu"],
    assumptions: [
      { text: "Characteristic length is the overall vehicle length.", basis: "Convention for a slender body; if you use a chord length instead, say so, because the friction coefficient changes." },
      { text: "Pure water viscosity, no salinity correction.", basis: "Salinity raises viscosity by roughly 5-8% at 35 PSU; small compared with the modelling error in drag." },
    ],
    warnings,
    inputs: input,
    confidence: "high",
  };
}

/* ------------------------------------------------------------------ */
/* Drag buildup                                                        */
/* ------------------------------------------------------------------ */

export interface DragBuildupInput {
  velocitySI: number;
  densitySI: number;
  temperatureC?: number;
  dynamicViscositySI?: number;

  /** Hull length, m. */
  hullLengthSI: number;
  /** Hull maximum diameter, m. */
  hullDiameterSI: number;
  /** Wetted area of the hull, m^2. If omitted it is estimated from L and D. */
  hullWettedAreaSI?: number;

  /** Total wing planform area (both wings), m^2. */
  wingAreaSI?: number;
  wingAspectRatio?: number;
  /** Wing thickness-to-chord ratio, for profile drag. */
  wingThicknessRatio?: number;
  /** Oswald span efficiency for induced drag. */
  oswaldEfficiency?: number;

  /** Tail / fin planform area, m^2. */
  tailAreaSI?: number;

  /** Lift coefficient at the operating point (for induced drag). */
  liftCoefficient?: number;

  /** Extra drag-area allowance for antennas, brackets, cables, m^2. */
  appendageDragAreaSI?: number;
  /** Multiplier applied to the whole buildup after calibration against test data. */
  calibrationFactor?: number;
}

export interface DragValues extends Record<string, Quantity | undefined> {
  reynolds: Quantity;
  frictionCoefficient: Quantity;
  formFactor: Quantity;
  hullWettedArea: Quantity;
  hullDrag: Quantity;
  wingProfileDrag: Quantity;
  inducedDrag: Quantity;
  appendageDrag: Quantity;
  totalDrag: Quantity;
  totalDragArea: Quantity;
  dragCoefficientOnWetted: Quantity;
  dynamicPressure: Quantity;
}

/** Wetted area of a cylinder with hemispherical ends. */
export function estimateHullWettedArea(lengthSI: number, diameterSI: number): number {
  const r = diameterSI / 2;
  const cylLength = Math.max(0, lengthSI - diameterSI); // two hemispheres consume one diameter
  return Math.PI * diameterSI * cylLength + 4 * Math.PI * r * r;
}

export function dragBuildup(input: DragBuildupInput): CalcResult<DragValues> {
  const warnings: CalcWarning[] = [];
  requireFinite(warnings, "Velocity", input.velocitySI, { min: 0, allowZero: true, field: "velocitySI" });
  requireFinite(warnings, "Hull length", input.hullLengthSI, { min: 1e-3, field: "hullLengthSI" });
  requireFinite(warnings, "Hull diameter", input.hullDiameterSI, { min: 1e-3, field: "hullDiameterSI" });

  const V = input.velocitySI;
  const rho = input.densitySI;
  const q = 0.5 * rho * V * V;

  const re = reynoldsNumber({
    velocitySI: V,
    characteristicLengthSI: input.hullLengthSI,
    densitySI: rho,
    dynamicViscositySI: input.dynamicViscositySI,
    temperatureC: input.temperatureC,
  });
  warnings.push(...re.warnings.filter((w) => w.severity !== "info"));
  const Re = re.values.reynolds.value;

  // ITTC-57 correlation line; guard the log for very low Re.
  let Cf: number;
  if (Re > 1e4) {
    Cf = 0.075 / Math.pow(Math.log10(Re) - 2, 2);
  } else if (Re > 0) {
    Cf = 1.328 / Math.sqrt(Re);
    warnings.push(
      info(`Re = ${Re.toExponential(2)} is too low for the ITTC-57 line; the Blasius laminar solution was used instead. ${COEFFICIENT_DEFAULTS.laminarNote}`),
    );
  } else {
    Cf = 0;
  }

  const dOverL = input.hullDiameterSI / input.hullLengthSI;
  const formFactor = 1 + 1.5 * Math.pow(dOverL, 1.5) + 7 * Math.pow(dOverL, 3);
  if (dOverL > 0.5) {
    warnings.push(
      warn(
        `Diameter/length = ${dOverL.toFixed(2)}. The Hoerner form-factor correlation is intended for slender bodies (roughly d/L < 0.3). ${COEFFICIENT_DEFAULTS.ovalNote}`,
      ),
    );
  }

  const Swet = input.hullWettedAreaSI ?? estimateHullWettedArea(input.hullLengthSI, input.hullDiameterSI);
  if (input.hullWettedAreaSI === undefined) {
    warnings.push(
      info(
        `Hull wetted area was estimated as a cylinder with hemispherical ends: ${(Swet * 1e4).toFixed(0)} cm^2. If you have a CAD surface area, enter it — it is usually the more reliable number.`,
      ),
    );
  }

  const hullDrag = q * Cf * formFactor * Swet;

  // Wing profile drag: treat as a flat plate at wing Reynolds number, with a
  // thickness correction. Chord is derived from area and aspect ratio.
  let wingProfile = 0;
  let induced = 0;
  const Sw = input.wingAreaSI ?? 0;
  const AR = input.wingAspectRatio ?? 0;
  if (Sw > 0) {
    const span = AR > 0 ? Math.sqrt(AR * Sw) : 0;
    const chord = span > 0 ? Sw / span : Math.sqrt(Sw);
    const reWing = chord > 0 ? (rho * V * chord) / (input.dynamicViscositySI ?? waterDynamicViscosity(input.temperatureC ?? 20).valueSI) : 0;
    const cfWing = reWing > 1e4 ? 0.075 / Math.pow(Math.log10(reWing) - 2, 2) : reWing > 0 ? 1.328 / Math.sqrt(reWing) : 0;
    const tc = input.wingThicknessRatio ?? 0.12;
    const wingFormFactor = 1 + 2 * tc + 60 * Math.pow(tc, 4);
    // Wetted area of a thin wing is about twice the planform area.
    const wingWetted = 2 * Sw * (1 + 0.2 * tc);
    wingProfile = q * cfWing * wingFormFactor * wingWetted;

    if (input.wingThicknessRatio === undefined) {
      warnings.push(
        info("Wing thickness-to-chord ratio was not given; 0.12 was used as an initial estimate (a common thin symmetric section). Enter the real value when the foil is chosen."),
      );
    }
    const CL = input.liftCoefficient ?? 0;
    const e = input.oswaldEfficiency ?? 0.8;
    if (AR > 0 && CL !== 0) {
      const CDi = (CL * CL) / (Math.PI * AR * e);
      induced = q * CDi * Sw;
      if (input.oswaldEfficiency === undefined) {
        warnings.push(
          info("Oswald span efficiency was not given; 0.8 was used as an initial estimate, a common value for a simple rectangular planform. It is an estimate, not a measurement."),
        );
      }
    }
    if (AR > 0 && AR < 2) {
      warnings.push(
        warn(
          `Wing aspect ratio ${AR.toFixed(2)} is very low. Classical lifting-line induced-drag and lift-slope relations lose accuracy below AR of about 2-3; low-aspect-ratio wings also develop significant non-linear vortex lift that this model does not represent.`,
        ),
      );
    }
  }

  let tailDrag = 0;
  if (input.tailAreaSI && input.tailAreaSI > 0) {
    tailDrag = q * Cf * 1.2 * 2 * input.tailAreaSI;
  }

  const appendage = input.appendageDragAreaSI ? q * input.appendageDragAreaSI : 0;
  if (!input.appendageDragAreaSI) {
    warnings.push(
      warn(
        "No appendage/roughness drag allowance was entered, so it is taken as ZERO. On a student-built vehicle, exposed brackets, screw heads, tape seams, a tether and a wet antenna commonly add 10-40% to total drag. Add an allowance or expect the prediction to be optimistic.",
      ),
    );
  }

  const calibration = input.calibrationFactor ?? 1;
  const total = (hullDrag + wingProfile + induced + tailDrag + appendage) * calibration;
  const dragArea = q > 0 ? total / q : 0;
  const cdOnWetted = q > 0 && Swet > 0 ? total / (q * Swet) : 0;

  if (calibration !== 1) {
    warnings.push(
      info(`A calibration factor of ${calibration.toFixed(3)} fitted to test data has been applied to the whole buildup. The uncalibrated prediction is retained for comparison.`),
    );
  }

  return {
    id: "hydro.drag_buildup",
    title: "Drag buildup",
    values: {
      reynolds: qty(Re, "-"),
      frictionCoefficient: qty(Cf, "-"),
      formFactor: qty(formFactor, "-"),
      hullWettedArea: qty(Swet, "m^2", input.hullWettedAreaSI === undefined ? "assumed" : "user"),
      hullDrag: qty(hullDrag, "N"),
      wingProfileDrag: qty(wingProfile + tailDrag, "N"),
      inducedDrag: qty(induced, "N"),
      appendageDrag: qty(appendage, "N"),
      totalDrag: qty(total, "N"),
      totalDragArea: qty(dragArea, "m^2"),
      dragCoefficientOnWetted: qty(cdOnWetted, "-"),
      dynamicPressure: qty(q, "Pa"),
    },
    steps: [
      { label: "Dynamic pressure", equation: "q = 0.5 * rho * V^2", substitution: `q = 0.5 * ${rho.toFixed(1)} * ${V.toPrecision(4)}^2`, result: `${q.toPrecision(4)} Pa` },
      { label: "Reynolds number (hull length)", equation: "Re = rho*V*L/mu", result: Re.toExponential(3) },
      {
        label: "Skin friction (ITTC-1957 line)",
        equation: "C_f = 0.075 / (log10(Re) - 2)^2",
        result: `C_f = ${Cf.toExponential(4)}`,
        note: COEFFICIENT_DEFAULTS.frictionLineNote,
      },
      {
        label: "Hull form factor (Hoerner)",
        equation: "(1+k) = 1 + 1.5*(d/L)^1.5 + 7*(d/L)^3",
        substitution: `d/L = ${dOverL.toFixed(4)}`,
        result: `(1+k) = ${formFactor.toFixed(4)}`,
        note: COEFFICIENT_DEFAULTS.hullFormFactorNote,
      },
      {
        label: "Hull drag",
        equation: "D_hull = q * C_f * (1+k) * S_wetted",
        substitution: `= ${q.toPrecision(4)} * ${Cf.toExponential(3)} * ${formFactor.toFixed(3)} * ${Swet.toPrecision(4)}`,
        result: `${hullDrag.toPrecision(4)} N`,
      },
      ...(Sw > 0
        ? [
            { label: "Wing + tail profile drag", equation: "D = q * C_f,wing * (1+k_wing) * S_wetted,wing", result: `${(wingProfile + tailDrag).toPrecision(4)} N` },
            { label: "Induced drag", equation: "D_i = q * S_wing * C_L^2 / (pi * AR * e)", result: `${induced.toPrecision(4)} N` },
          ]
        : []),
      { label: "Appendage / roughness allowance", equation: "D_app = q * (CD*A)_app", result: `${appendage.toPrecision(4)} N` },
      { label: "Total drag", equation: "D = sum of components" + (calibration !== 1 ? " x calibration" : ""), result: `${total.toPrecision(4)} N` },
    ],
    equations: [
      "q = 0.5*rho*V^2",
      "C_f = 0.075/(log10(Re)-2)^2  [ITTC-57]",
      "(1+k) = 1 + 1.5(d/L)^1.5 + 7(d/L)^3  [Hoerner]",
      "D = q*C_f*(1+k)*S_wet + q*C_D,wing*S_wing + q*C_L^2/(pi*AR*e)*S_wing",
    ],
    assumptions: [
      { text: "Fully turbulent boundary layer over the hull.", basis: "Implied by the ITTC-57 correlation line, which is the standard preliminary-design choice." },
      { text: "Streamlined, smooth body of revolution.", basis: "Hoerner form-factor correlation. A bare tube with flat ends will have far more pressure drag than this predicts." },
      { text: "Wing and hull drag simply add (no interference).", basis: "Component-buildup convention. Wing-body junction interference typically adds a few percent and is not modelled." },
      { text: "Steady, non-cavitating, single-phase flow, deeply submerged.", basis: "No free-surface wave drag is included, which is wrong within roughly one hull diameter of the surface." },
    ],
    warnings,
    inputs: input,
    confidence: "low",
    limitations: [
      "A component buildup is a preliminary estimate. For a small student-built vehicle, errors of 30-50% against measurement are entirely normal.",
      "No free-surface wave drag, no unsteady/added-mass effects, no interference drag, no cross-flow drag at angle of attack.",
      "Use a tow test to calibrate this model before quoting a range or endurance number in a report.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Steady glide equilibrium                                            */
/* ------------------------------------------------------------------ */

export interface GlideInput {
  /** Magnitude of the net buoyancy force driving the glide, N. */
  netBuoyancyForceSI: number;
  densitySI: number;
  /** Reference area the coefficients are based on, m^2. */
  referenceAreaSI: number;
  liftCoefficient: number;
  dragCoefficient: number;
  /** True for a dive (sinking), false for a climb. */
  descending: boolean;
  coefficientSource: "user" | "buildup" | "experimental" | "assumed";
}

export interface GlideValues extends Record<string, Quantity | undefined> {
  glidePathAngle: Quantity;
  glideRatio: Quantity;
  speed: Quantity;
  horizontalSpeed: Quantity;
  verticalSpeed: Quantity;
  lift: Quantity;
  drag: Quantity;
  resultantForce: Quantity;
}

/**
 * Steady-state glide of a buoyancy-driven vehicle.
 *
 * In equilibrium the resultant hydrodynamic force balances the net buoyancy:
 *
 *   |F_net| = sqrt(L^2 + D^2) = 0.5*rho*V^2*S*sqrt(C_L^2 + C_D^2)
 *   =>  V = sqrt( 2|F_net| / (rho*S*sqrt(C_L^2 + C_D^2)) )
 *
 * and the glide path angle below the horizontal follows from
 *
 *   tan(gamma) = D / L = C_D / C_L,     glide ratio = C_L / C_D = 1/tan(gamma)
 */
export function glideEquilibrium(input: GlideInput): CalcResult<GlideValues> {
  const warnings: CalcWarning[] = [];
  const Fnet = Math.abs(input.netBuoyancyForceSI);
  const rho = input.densitySI;
  const S = input.referenceAreaSI;
  const CL = input.liftCoefficient;
  const CD = input.dragCoefficient;

  requireFinite(warnings, "Net buoyancy force", Fnet, { min: 0, allowZero: true, field: "netBuoyancyForceSI" });
  requireFinite(warnings, "Reference area", S, { min: 1e-6, field: "referenceAreaSI" });
  requireFinite(warnings, "Drag coefficient", CD, { min: 0, field: "dragCoefficient" });

  if (CD <= 0) {
    warnings.push(err("Drag coefficient must be greater than zero."));
  }
  if (Fnet === 0) {
    warnings.push(err("Net buoyancy force is zero — a neutrally buoyant glider has no driving force and will not glide. Actuate the buoyancy engine first."));
  }
  if (input.coefficientSource === "assumed") {
    warnings.push(
      warn("The lift and drag coefficients are ASSUMED values. Every speed, angle and range below inherits that assumption; treat them as scoping numbers only."),
    );
  }

  const magnitude = Math.sqrt(CL * CL + CD * CD);
  const V = magnitude > 0 && S > 0 && rho > 0 ? Math.sqrt((2 * Fnet) / (rho * S * magnitude)) : 0;
  const gamma = CL !== 0 ? Math.atan(CD / CL) : Math.PI / 2;
  const glideRatio = CD > 0 ? CL / CD : 0;
  const q = 0.5 * rho * V * V;
  const lift = q * S * CL;
  const drag = q * S * CD;
  const sign = input.descending ? -1 : 1;
  const verticalSpeed = sign * V * Math.sin(gamma);
  const horizontalSpeed = V * Math.cos(gamma);

  if (CL === 0) {
    warnings.push(
      info(
        "With zero lift coefficient the vehicle does not glide — it rises or sinks vertically at its terminal velocity. The glide path angle is reported as 90 degrees.",
      ),
    );
  }
  if (glideRatio > 8) {
    warnings.push(
      warn(
        `A glide ratio of ${glideRatio.toFixed(1)} would be exceptional for a small, hand-built vehicle. Operational research gliders typically achieve roughly 2-4. Re-check the drag estimate — an unrealistically low C_D is the usual cause.`,
      ),
    );
  }
  if (V > 3) {
    warnings.push(warn(`Predicted glide speed of ${V.toFixed(2)} m/s is very high for a buoyancy-driven laboratory vehicle. Check the net buoyancy and reference area.`));
  }

  return {
    id: "hydro.glide",
    title: `Steady glide equilibrium (${input.descending ? "dive" : "climb"})`,
    values: {
      glidePathAngle: qty(gamma, "rad"),
      glideRatio: qty(glideRatio, "-"),
      speed: qty(V, "m/s"),
      horizontalSpeed: qty(horizontalSpeed, "m/s"),
      verticalSpeed: qty(verticalSpeed, "m/s"),
      lift: qty(lift, "N"),
      drag: qty(drag, "N"),
      resultantForce: qty(Math.sqrt(lift * lift + drag * drag), "N"),
    },
    steps: [
      {
        label: "Force balance along the glide path",
        equation: "|F_net| = sqrt(L^2 + D^2) = q*S*sqrt(C_L^2 + C_D^2)",
        substitution: `${Fnet.toPrecision(4)} N = 0.5*${rho.toFixed(1)}*V^2*${S.toPrecision(4)}*sqrt(${CL}^2+${CD}^2)`,
        result: `V = ${V.toPrecision(4)} m/s`,
      },
      {
        label: "Glide path angle below horizontal",
        equation: "tan(gamma) = C_D / C_L",
        substitution: `tan(gamma) = ${CD} / ${CL}`,
        result: `gamma = ${((gamma * 180) / Math.PI).toPrecision(4)} deg`,
      },
      { label: "Glide ratio", equation: "L/D = C_L / C_D", result: glideRatio.toPrecision(4) },
      {
        label: "Velocity components",
        equation: "V_h = V cos(gamma),  V_v = V sin(gamma)",
        result: `V_h = ${horizontalSpeed.toPrecision(4)} m/s, V_v = ${Math.abs(verticalSpeed).toPrecision(4)} m/s ${input.descending ? "downwards" : "upwards"}`,
      },
    ],
    equations: ["V = sqrt(2|F_net| / (rho*S*sqrt(C_L^2+C_D^2)))", "tan(gamma) = C_D/C_L", "L/D = C_L/C_D"],
    assumptions: [
      { text: "Steady, equilibrium glide: accelerations are zero.", basis: "The transient after each buoyancy change is ignored. For a small vehicle the transient lasts a few seconds and shortens the useful glide." },
      { text: "Lift and drag coefficients are constant over the glide.", basis: "They actually vary with angle of attack, which itself depends on the pitch trim." },
      { text: "The vehicle is trimmed so that the hydrodynamic angle of attack matches the coefficients supplied.", basis: "This model does NOT solve the pitch-moment balance. A vehicle that is not trimmed will glide at a different angle of attack than assumed." },
      { text: "Added mass and unsteady effects are neglected.", basis: "Added mass of a submerged body is comparable to its own mass and matters during the transient, not in steady glide." },
      { text: "No ambient current.", basis: "Current is added separately in the mission simulator." },
    ],
    warnings,
    inputs: input,
    confidence: input.coefficientSource === "experimental" ? "medium" : "low",
    limitations: [
      "Equilibrium glide only. It cannot predict whether the vehicle actually reaches that equilibrium, nor its pitch stability getting there.",
      "The pitch-moment balance is not solved, so the angle of attack is an input, not a result.",
    ],
  };
}

/** Finite-wing lift-curve slope (Helmbold/Diederich low-aspect-ratio form). */
export function liftCurveSlope(aspectRatio: number): { perRad: number; equation: string; note: string } {
  const a = (2 * Math.PI * aspectRatio) / (2 + Math.sqrt(aspectRatio * aspectRatio + 4));
  return {
    perRad: a,
    equation: "a = 2*pi*AR / (2 + sqrt(AR^2 + 4))",
    note: "Helmbold's low-aspect-ratio extension of lifting-line theory. It tends to the 2*pi thin-aerofoil result at high AR and stays sensible at low AR, which is why it is used here rather than the classical lifting-line form.",
  };
}
