import { qty, type Quantity } from "@/lib/units";
import { err, info, warn, type CalcResult, type CalcWarning } from "./types";

/**
 * Vehicle coordinate system (fixed by this application and shown in the UI):
 *
 *   +x : forward, towards the nose
 *   +y : to port (vehicle's left)
 *   +z : up
 *   origin: user-chosen datum, conventionally the nose tip on the hull axis.
 *
 * A right-handed frame. Pitch is rotation about +y (nose-down = negative
 * pitch), roll about +x, yaw about +z.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scaleVec(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function normVec(a: Vec3): number {
  return Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2);
}

/**
 * How a component interacts with the surrounding water. Getting this wrong is
 * the single most common source of a wrong buoyancy budget, so the model is
 * explicit rather than inferred.
 */
export type DisplacementMode =
  | "hull" // the pressure envelope itself: its external envelope displaces water
  | "external" // mounted outside the hull, displaces its own external volume
  | "internal" // inside a sealed hull: contributes mass only, no displacement
  | "flooded"; // in a free-flooding bay: displaces only its own solid volume

export interface CalcComponent {
  id: string;
  name: string;
  category: string;
  /** How many identical units are installed. */
  quantity: number;
  /** Mass of ONE unit, kg. Undefined = unknown (flagged, not assumed). */
  massSI?: number;
  massProvenance?: "measured" | "estimated" | "cad" | "unknown";
  /** Displaced volume of ONE unit, m^3. Meaning depends on displacementMode. */
  displacedVolumeSI?: number;
  volumeProvenance?: "measured" | "cad" | "user" | "estimated" | "unknown";
  displacementMode: DisplacementMode;
  /** Reference position in the vehicle frame, m. */
  position: Vec3;
  /** Centre of mass relative to `position`, m. */
  comOffset?: Vec3;
  /** Volume centroid relative to `position`, m. Defaults to comOffset. */
  volumeCentroidOffset?: Vec3;
  includeInBudget: boolean;
  confidence?: "high" | "medium" | "low";
}

export interface MassPropsValues extends Record<string, Quantity | undefined> {
  totalMass: Quantity;
  totalDisplacedVolume: Quantity;
  cgX: Quantity;
  cgY: Quantity;
  cgZ: Quantity;
  cbX: Quantity;
  cbY: Quantity;
  cbZ: Quantity;
  separationLongitudinal: Quantity;
  separationVertical: Quantity;
  separationLateral: Quantity;
}

export interface ComponentContribution {
  id: string;
  name: string;
  category: string;
  massSI: number;
  massFraction: number;
  volumeSI: number;
  volumeFraction: number;
  displacementMode: DisplacementMode;
  massKnown: boolean;
  volumeKnown: boolean;
}

export interface MassPropsResult extends CalcResult<MassPropsValues> {
  cg: Vec3;
  cb: Vec3;
  contributions: ComponentContribution[];
  /** Components with no mass entered — these silently bias the budget. */
  missingMass: string[];
  missingVolume: string[];
  includedCount: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function computeMassProperties(components: CalcComponent[]): MassPropsResult {
  const warnings: CalcWarning[] = [];
  const included = components.filter((c) => c.includeInBudget);

  let totalMass = 0;
  let totalVolume = 0;
  let momentM: Vec3 = { ...ZERO };
  let momentV: Vec3 = { ...ZERO };
  const missingMass: string[] = [];
  const missingVolume: string[] = [];
  const raw: { c: CalcComponent; mass: number; volume: number }[] = [];

  for (const c of included) {
    const n = isNum(c.quantity) && c.quantity > 0 ? c.quantity : 1;
    const massKnown = isNum(c.massSI) && c.massSI >= 0;
    const mass = massKnown ? (c.massSI as number) * n : 0;

    const displaces = c.displacementMode !== "internal";
    const volKnown = isNum(c.displacedVolumeSI) && c.displacedVolumeSI >= 0;
    const volume = displaces && volKnown ? (c.displacedVolumeSI as number) * n : 0;

    if (!massKnown) missingMass.push(c.name);
    if (displaces && !volKnown) missingVolume.push(c.name);

    if (isNum(c.massSI) && (c.massSI as number) < 0) {
      warnings.push(err(`Component "${c.name}" has a negative mass. Negative mass is not physical.`, c.id));
    }
    if (isNum(c.displacedVolumeSI) && (c.displacedVolumeSI as number) < 0) {
      warnings.push(err(`Component "${c.name}" has a negative volume.`, c.id));
    }
    if (c.displacementMode === "internal" && isNum(c.displacedVolumeSI) && (c.displacedVolumeSI as number) > 0) {
      warnings.push(
        info(
          `"${c.name}" is marked as internal to a sealed hull, so its volume (${((c.displacedVolumeSI as number) * 1e6).toFixed(1)} cm^3) is deliberately NOT counted as displacement — the hull envelope already accounts for it. Change the displacement mode if this part is actually exposed to water.`,
          c.id,
        ),
      );
    }
    if (massKnown && volKnown && volume > 0 && displaces) {
      const density = mass / volume;
      if (density > 0 && density < 20) {
        warnings.push(
          warn(
            `"${c.name}" implies a density of ${density.toFixed(1)} kg/m^3, lighter than air. Check for a unit error (cm^3 vs m^3 is the usual culprit).`,
            c.id,
          ),
        );
      } else if (density > 22000) {
        warnings.push(
          warn(
            `"${c.name}" implies a density of ${density.toFixed(0)} kg/m^3, denser than any common engineering material (osmium is about 22600). Check the mass and volume units.`,
            c.id,
          ),
        );
      }
    }

    const comPos = addVec(c.position, c.comOffset ?? ZERO);
    const volPos = addVec(c.position, c.volumeCentroidOffset ?? c.comOffset ?? ZERO);

    totalMass += mass;
    momentM = addVec(momentM, scaleVec(comPos, mass));
    totalVolume += volume;
    momentV = addVec(momentV, scaleVec(volPos, volume));
    raw.push({ c, mass, volume });
  }

  const cg: Vec3 = totalMass > 0 ? scaleVec(momentM, 1 / totalMass) : { x: NaN, y: NaN, z: NaN };
  const cb: Vec3 = totalVolume > 0 ? scaleVec(momentV, 1 / totalVolume) : { x: NaN, y: NaN, z: NaN };

  if (included.length === 0) {
    warnings.push(err("No components are included in the budget, so nothing can be computed."));
  }
  if (missingMass.length > 0) {
    warnings.push(
      err(
        `${missingMass.length} included component(s) have no mass entered (${missingMass
          .slice(0, 5)
          .join(", ")}${missingMass.length > 5 ? ", …" : ""}). They are counted as ZERO, so the total mass and the CG are both biased. This is not an estimate — it is missing data.`,
      ),
    );
  }
  if (missingVolume.length > 0) {
    warnings.push(
      err(
        `${missingVolume.length} water-exposed component(s) have no displaced volume (${missingVolume
          .slice(0, 5)
          .join(", ")}${missingVolume.length > 5 ? ", …" : ""}). Displacement and the centre of buoyancy are therefore underestimated.`,
      ),
    );
  }
  const hullParts = included.filter((c) => c.displacementMode === "hull");
  if (hullParts.length === 0 && included.length > 0) {
    warnings.push(
      warn(
        "No component is marked as the pressure hull envelope. In a sealed-hull vehicle the hull's EXTERNAL envelope volume is normally the dominant displacement term; without it the centre of buoyancy is unreliable.",
      ),
    );
  }
  if (hullParts.length > 1) {
    warnings.push(
      info(
        `${hullParts.length} components are marked as hull envelope. That is legitimate for a multi-section hull, but make sure the sections do not overlap — overlapping envelopes double-count displacement.`,
      ),
    );
  }

  const contributions: ComponentContribution[] = raw
    .map(({ c, mass, volume }) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      massSI: mass,
      massFraction: totalMass > 0 ? mass / totalMass : 0,
      volumeSI: volume,
      volumeFraction: totalVolume > 0 ? volume / totalVolume : 0,
      displacementMode: c.displacementMode,
      massKnown: isNum(c.massSI),
      volumeKnown: c.displacementMode === "internal" || isNum(c.displacedVolumeSI),
    }))
    .sort((a, b) => b.massSI - a.massSI);

  const sepX = Number.isFinite(cg.x) && Number.isFinite(cb.x) ? cb.x - cg.x : NaN;
  const sepZ = Number.isFinite(cg.z) && Number.isFinite(cb.z) ? cb.z - cg.z : NaN;
  const sepY = Number.isFinite(cg.y) && Number.isFinite(cb.y) ? cb.y - cg.y : NaN;

  return {
    id: "massprops.cg_cb",
    title: "Mass properties, CG and CB",
    values: {
      totalMass: qty(totalMass, "kg"),
      totalDisplacedVolume: qty(totalVolume, "m^3"),
      cgX: qty(cg.x, "m"),
      cgY: qty(cg.y, "m"),
      cgZ: qty(cg.z, "m"),
      cbX: qty(cb.x, "m"),
      cbY: qty(cb.y, "m"),
      cbZ: qty(cb.z, "m"),
      separationLongitudinal: qty(sepX, "m"),
      separationVertical: qty(sepZ, "m"),
      separationLateral: qty(sepY, "m"),
    },
    cg,
    cb,
    contributions,
    missingMass,
    missingVolume,
    includedCount: included.length,
    steps: [
      {
        label: "Total mass",
        equation: "m_total = sum( n_i * m_i )",
        substitution: `${raw.length} component rows`,
        result: `m_total = ${totalMass.toPrecision(6)} kg`,
      },
      {
        label: "Centre of gravity",
        equation: "r_CG = sum( m_i * r_i ) / sum( m_i )",
        substitution: `(${momentM.x.toPrecision(5)}, ${momentM.y.toPrecision(5)}, ${momentM.z.toPrecision(5)}) kg*m / ${totalMass.toPrecision(6)} kg`,
        result: `r_CG = (${cg.x.toPrecision(5)}, ${cg.y.toPrecision(5)}, ${cg.z.toPrecision(5)}) m`,
      },
      {
        label: "Total displaced volume",
        equation: "V_total = sum( n_i * V_i )  over water-exposed components",
        result: `V_total = ${totalVolume.toExponential(5)} m^3 = ${(totalVolume * 1e6).toPrecision(5)} cm^3`,
      },
      {
        label: "Centre of buoyancy",
        equation: "r_CB = sum( V_i * r_Vi ) / sum( V_i )",
        substitution: `(${momentV.x.toExponential(4)}, ${momentV.y.toExponential(4)}, ${momentV.z.toExponential(4)}) m^4 / ${totalVolume.toExponential(4)} m^3`,
        result: `r_CB = (${cb.x.toPrecision(5)}, ${cb.y.toPrecision(5)}, ${cb.z.toPrecision(5)}) m`,
        note: "The CB is the centroid of the displaced volume. It depends only on geometry, never on mass.",
      },
      {
        label: "CB - CG separation",
        equation: "d = r_CB - r_CG",
        result: `longitudinal ${(sepX * 1000).toFixed(1)} mm, vertical ${(sepZ * 1000).toFixed(1)} mm, lateral ${(sepY * 1000).toFixed(1)} mm`,
        note: "A positive vertical separation (CB above CG) is what gives a submerged vehicle its righting moment.",
      },
    ],
    equations: ["r_CG = sum(m_i r_i)/sum(m_i)", "r_CB = sum(V_i r_Vi)/sum(V_i)"],
    assumptions: [
      {
        text: "Each component's mass acts at a single point (its centre of mass); distributed parts are lumped.",
        basis: "Standard rigid-body mass-properties treatment. Adequate for CG location; NOT adequate for moments of inertia of long slender parts.",
      },
      {
        text: "Component positions are exact in the vehicle frame.",
        basis: "Positions come from CAD or the user. Real build tolerances of a few millimetres shift the CG and matter for trim.",
      },
      {
        text: "Components marked 'internal' contribute no displacement because the hull envelope already includes their volume.",
        basis: "Explicit displacement model of this application.",
      },
    ],
    warnings,
    inputs: { componentCount: components.length, includedCount: included.length },
    confidence: missingMass.length > 0 || missingVolume.length > 0 ? "low" : "high",
    limitations: [
      "Moments of inertia are not computed; this result cannot be used for dynamic-response or added-mass analysis.",
      "The CB assumes the vehicle is fully submerged and that the listed volumes tile the vehicle without overlap.",
    ],
  };
}
