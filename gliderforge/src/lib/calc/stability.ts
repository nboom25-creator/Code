import { qty, type Quantity } from "@/lib/units";
import { G_STANDARD } from "@/lib/reference/water";
import { err, info, requireFinite, warn, type CalcResult, type CalcWarning } from "./types";
import type { Vec3 } from "./massprops";

/**
 * Static stability and trim of a FULLY SUBMERGED body.
 *
 * A submerged vehicle has no waterplane, so there is no metacentre in the
 * surface-ship sense. Its entire static righting moment comes from the
 * separation between the centre of buoyancy and the centre of gravity:
 *
 *   M_righting = rho * g * V * BG * sin(theta)
 *
 * where BG is the distance between CB and CG. The vehicle is statically
 * stable in pitch and roll if and only if the CB lies ABOVE the CG.
 *
 * Sign conventions used throughout (vehicle frame: +x forward, +y to port,
 * +z up):
 *   pitch  - nose-UP positive
 *   roll   - port-side-UP positive
 */

export interface StabilityInput {
  cg: Vec3;
  cb: Vec3;
  displacedVolumeSI: number;
  waterDensitySI: number;
  massSI: number;
  gravitySI?: number;
  /** Angle at which to report the righting moment, radians. */
  evaluationAngleSI?: number;
}

export interface StabilityValues extends Record<string, Quantity | undefined> {
  bgDistance: Quantity;
  verticalSeparation: Quantity;
  longitudinalSeparation: Quantity;
  lateralSeparation: Quantity;
  equilibriumPitch: Quantity;
  equilibriumRoll: Quantity;
  rightingMomentAtAngle: Quantity;
  rightingMomentPerRadian: Quantity;
  pitchStiffness: Quantity;
}

export function computeStability(input: StabilityInput): CalcResult<StabilityValues> {
  const warnings: CalcWarning[] = [];
  const g = input.gravitySI ?? G_STANDARD;
  const theta = input.evaluationAngleSI ?? (10 * Math.PI) / 180;

  const finite =
    Number.isFinite(input.cg.x) &&
    Number.isFinite(input.cg.z) &&
    Number.isFinite(input.cb.x) &&
    Number.isFinite(input.cb.z);
  if (!finite) {
    warnings.push(
      err(
        "The centre of gravity or centre of buoyancy could not be determined (missing component masses or volumes). No stability conclusion is possible from the data entered.",
      ),
    );
  }
  requireFinite(warnings, "Displaced volume", input.displacedVolumeSI, { min: 0, allowZero: true, field: "displacedVolumeSI" });

  const dx = input.cb.x - input.cg.x;
  const dy = input.cb.y - input.cg.y;
  const dz = input.cb.z - input.cg.z;
  const bg = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const buoyantForce = input.waterDensitySI * g * input.displacedVolumeSI;
  const rightingAtAngle = buoyantForce * bg * Math.sin(theta);
  const stiffness = buoyantForce * bg; // dM/dtheta at small angles

  // Equilibrium attitude: the vehicle rotates until CB is directly above CG.
  const equilibriumPitch = Number.isFinite(dz) && dz !== 0 ? Math.atan2(dx, dz) : NaN;
  const equilibriumRoll = Number.isFinite(dz) && dz !== 0 ? Math.atan2(dy, dz) : NaN;

  if (finite) {
    if (dz <= 0) {
      warnings.push(
        err(
          `The centre of buoyancy is ${dz === 0 ? "at the same height as" : "BELOW"} the centre of gravity (dz = ${(dz * 1000).toFixed(1)} mm). A fully submerged vehicle in this condition has no righting moment in roll and will capsize or hang at an arbitrary attitude. Move mass down or displacement up.`,
        ),
      );
    } else if (dz < 0.002) {
      warnings.push(
        warn(
          `Vertical CB-CG separation is only ${(dz * 1000).toFixed(1)} mm. That is inside the build tolerance of most student vehicles, so the sign of the separation is not reliably known. Aim for at least 5-10 mm on a vehicle of this scale, and verify by watching how briskly it self-rights in a tank.`,
        ),
      );
    }
    if (Math.abs(dy) > 0.002) {
      warnings.push(
        warn(
          `Lateral CB-CG offset is ${(dy * 1000).toFixed(1)} mm, so the vehicle will hang with a permanent roll of about ${((equilibriumRoll * 180) / Math.PI).toFixed(1)} degrees. A rolled glider turns instead of gliding straight. Move mass laterally to null this.`,
        ),
      );
    }
    if (Math.abs(equilibriumPitch) > (30 * Math.PI) / 180) {
      warnings.push(
        warn(
          `The static equilibrium pitch of ${((equilibriumPitch * 180) / Math.PI).toFixed(1)} degrees is large. At this attitude the hull is far from aligned with the flow and the drag model's assumptions break down.`,
        ),
      );
    }
    const weight = input.massSI * g;
    if (Math.abs(buoyantForce - weight) / Math.max(weight, 1e-9) > 0.05) {
      warnings.push(
        info(
          "The vehicle is not close to neutral, so in practice it will accelerate vertically rather than sit at this static equilibrium attitude. The angles here describe the attitude it tends towards, not a hovering condition.",
        ),
      );
    }
  }
  warnings.push(
    info(
      "This is STATIC stability only. It says nothing about dynamic pitch oscillation, which depends on added mass, damping from the wings and fins, and how fast the buoyancy engine moves. A statically stable glider can still porpoise.",
    ),
  );

  return {
    id: "stability.static",
    title: "Static stability and trim",
    values: {
      bgDistance: qty(bg, "m"),
      verticalSeparation: qty(dz, "m"),
      longitudinalSeparation: qty(dx, "m"),
      lateralSeparation: qty(dy, "m"),
      equilibriumPitch: qty(equilibriumPitch, "rad"),
      equilibriumRoll: qty(equilibriumRoll, "rad"),
      rightingMomentAtAngle: qty(rightingAtAngle, "N*m"),
      rightingMomentPerRadian: qty(stiffness, "N*m"),
      pitchStiffness: qty(stiffness, "N*m"),
    },
    steps: [
      {
        label: "CB - CG vector",
        equation: "d = r_CB - r_CG",
        result: `(${(dx * 1000).toFixed(2)}, ${(dy * 1000).toFixed(2)}, ${(dz * 1000).toFixed(2)}) mm, |BG| = ${(bg * 1000).toFixed(2)} mm`,
      },
      {
        label: "Static equilibrium pitch",
        equation: "theta_eq = atan2(dx, dz)   [nose-up positive]",
        substitution: `atan2(${(dx * 1000).toFixed(2)} mm, ${(dz * 1000).toFixed(2)} mm)`,
        result: `${((equilibriumPitch * 180) / Math.PI).toFixed(2)} deg`,
        note: "The vehicle rotates until the CB sits directly above the CG. A CB aft of the CG gives a nose-down attitude.",
      },
      {
        label: "Static equilibrium roll",
        equation: "phi_eq = atan2(dy, dz)   [port-up positive]",
        result: `${((equilibriumRoll * 180) / Math.PI).toFixed(2)} deg`,
      },
      {
        label: "Righting moment",
        equation: "M = rho * g * V * BG * sin(theta)",
        substitution: `M = ${buoyantForce.toPrecision(4)} N * ${(bg * 1000).toFixed(2)} mm * sin(${((theta * 180) / Math.PI).toFixed(1)} deg)`,
        result: `${rightingAtAngle.toPrecision(4)} N*m at ${((theta * 180) / Math.PI).toFixed(1)} deg of disturbance`,
      },
      {
        label: "Small-angle stiffness",
        equation: "dM/dtheta = rho*g*V*BG",
        result: `${stiffness.toPrecision(4)} N*m per radian`,
      },
    ],
    equations: ["M = rho*g*V*BG*sin(theta)", "theta_eq = atan2(dx, dz)"],
    assumptions: [
      { text: "The vehicle is fully and continuously submerged.", basis: "There is no waterplane and therefore no metacentric contribution. On the surface this analysis does not apply." },
      { text: "The body is rigid and the CB does not move as the vehicle rotates.", basis: "True for a rigid hull. NOT true if a flexible bladder or trapped air pocket shifts with attitude." },
      { text: "No hydrodynamic moments.", basis: "Static analysis only. In motion, fins and the hull generate pitching moments that can dominate the buoyant righting moment." },
    ],
    warnings,
    inputs: input,
    confidence: finite ? "medium" : "low",
    limitations: [
      "Static only — no dynamics, no damping, no added mass, no hydrodynamic pitching moment.",
      "The result is only as good as the CB estimate, which depends on having every water-exposed volume entered correctly.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Trim solver                                                         */
/* ------------------------------------------------------------------ */

export interface MovableComponent {
  id: string;
  name: string;
  massSI: number;
  positionX: number;
  /** Allowed travel along x, m. */
  minX: number;
  maxX: number;
}

export interface TrimSolution {
  componentId: string;
  componentName: string;
  currentX: number;
  requiredX: number;
  travelSI: number;
  withinLimits: boolean;
  limitedTo?: number;
  achievablePitchDeg: number;
  note: string;
}

export interface TrimSolverResult {
  targetPitchDeg: number;
  requiredCgShiftSI: number;
  requiredCgX: number;
  currentCgX: number;
  solutions: TrimSolution[];
  warnings: CalcWarning[];
  steps: { label: string; equation?: string; result: string }[];
  nonUniqueness: string;
}

/**
 * Solve for the component movement needed to reach a target static pitch.
 *
 * From the equilibrium condition tan(theta) = dx / dz with dx = x_CB - x_CG:
 *
 *   x_CG,required = x_CB - dz * tan(theta_target)
 *
 * Moving a single component of mass m by delta shifts the whole-vehicle CG by
 * m*delta / M_total, so
 *
 *   delta = (x_CG,required - x_CG,current) * M_total / m
 *
 * Each movable component is solved INDEPENDENTLY. Any combination of these
 * movements that produces the same total moment shift also works, which is
 * why the result is explicitly reported as non-unique.
 */
export function solveTrim(
  targetPitchRad: number,
  current: { cgX: number; cbX: number; verticalSeparationSI: number; totalMassSI: number },
  movable: MovableComponent[],
): TrimSolverResult {
  const warnings: CalcWarning[] = [];
  const dz = current.verticalSeparationSI;

  if (!Number.isFinite(dz) || dz <= 0) {
    warnings.push(
      err(
        "The vertical CB-CG separation is zero, negative or unknown. Pitch trim cannot be solved: with the CB at or below the CG there is no restoring moment to trim against.",
      ),
    );
  }
  const requiredCgX = current.cbX - dz * Math.tan(targetPitchRad);
  const shift = requiredCgX - current.cgX;

  const solutions: TrimSolution[] = movable.map((c) => {
    const delta = c.massSI > 0 ? (shift * current.totalMassSI) / c.massSI : NaN;
    const requiredX = c.positionX + delta;
    const within = requiredX >= c.minX - 1e-12 && requiredX <= c.maxX + 1e-12;
    const limited = within ? undefined : Math.min(c.maxX, Math.max(c.minX, requiredX));
    // Pitch actually achievable if the component is driven to its limit.
    const achievableCgX =
      limited === undefined ? requiredCgX : current.cgX + ((limited - c.positionX) * c.massSI) / current.totalMassSI;
    const achievablePitch = Math.atan2(current.cbX - achievableCgX, dz);
    return {
      componentId: c.id,
      componentName: c.name,
      currentX: c.positionX,
      requiredX,
      travelSI: delta,
      withinLimits: within,
      limitedTo: limited,
      achievablePitchDeg: (achievablePitch * 180) / Math.PI,
      note: within
        ? `Move "${c.name}" by ${(delta * 1000).toFixed(1)} mm ${delta >= 0 ? "forward" : "aft"}.`
        : `"${c.name}" would have to move to x = ${(requiredX * 1000).toFixed(1)} mm, outside its allowed travel of ${(c.minX * 1000).toFixed(0)}..${(c.maxX * 1000).toFixed(0)} mm. At its limit it can only reach ${((achievablePitch * 180) / Math.PI).toFixed(1)} deg.`,
    };
  });

  if (movable.length === 0) {
    warnings.push(
      err("No components were marked movable, so there is nothing to trim with. Mark the battery or a ballast mass as movable and give it a travel range."),
    );
  }
  if (solutions.length > 0 && solutions.every((s) => !s.withinLimits)) {
    warnings.push(
      err("No single movable component can reach the target pitch within its travel limits. Either combine several movements, add a dedicated trim mass, or relax the target."),
    );
  }
  for (const s of solutions) {
    if (Math.abs(s.travelSI) > 0.5) {
      warnings.push(
        warn(`The movement required of "${s.componentName}" (${(s.travelSI * 1000).toFixed(0)} mm) is very large — it probably exceeds the vehicle. Consider a heavier trim mass instead.`),
      );
    }
  }
  warnings.push(
    warn(
      "Moving a component changes the displaced-volume distribution too if that component is water-exposed, which moves the CB as well as the CG. This solver holds the CB fixed; re-run the mass-properties calculation after applying a move and check the result.",
    ),
  );

  return {
    targetPitchDeg: (targetPitchRad * 180) / Math.PI,
    requiredCgShiftSI: shift,
    requiredCgX,
    currentCgX: current.cgX,
    solutions,
    warnings,
    steps: [
      {
        label: "Required CG longitudinal position",
        equation: "x_CG,req = x_CB - dz * tan(theta_target)",
        result: `${(requiredCgX * 1000).toFixed(2)} mm (currently ${(current.cgX * 1000).toFixed(2)} mm)`,
      },
      {
        label: "Required CG shift",
        equation: "shift = x_CG,req - x_CG,now",
        result: `${(shift * 1000).toFixed(2)} mm ${shift >= 0 ? "forward" : "aft"}`,
      },
      {
        label: "Movement of a single component",
        equation: "delta = shift * M_total / m_component",
        result: `${movable.length} candidate component(s) evaluated independently`,
      },
    ],
    nonUniqueness:
      "This is NOT a unique answer. Any set of component movements whose total moment change equals shift x M_total achieves the same trim — moving one heavy item a little, or a light item a lot, or several items together. The options listed are single-component solutions offered as starting points, not a prescription.",
  };
}
