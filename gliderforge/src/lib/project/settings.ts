import { z } from "zod";
import type { EngineConfig } from "@/lib/calc/syringe";

/**
 * Project settings: the shared engineering context every module reads.
 *
 * Anything here is entered once and used everywhere, which is what makes the
 * modules consistent with each other. All values are SI unless the field name
 * says otherwise.
 */

export const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });

// Note on `.prefault({})`: in Zod 4, `.default()` is typed against the OUTPUT
// shape, so `.default({})` on a nested object whose fields all have their own
// defaults does not type-check. `.prefault()` applies the value on the INPUT
// side, before parsing, which is the behaviour wanted here: an absent settings
// group is filled in from its members' own defaults.
export const projectSettingsSchema = z.object({
  displayUnitSystem: z.enum(["SI", "US"]).default("SI"),
  theme: z.enum(["dark", "light", "system"]).default("system"),

  environment: z.object({
    kind: z.enum(["pool", "tank", "lake", "ocean", "other"]).default("pool"),
    temperatureC: z.number().default(25),
    salinityPSU: z.number().min(0).default(0),
    /** If set, overrides the correlation entirely. kg/m^3. */
    densityOverrideSI: z.number().positive().optional(),
    densityOverrideSource: z.string().optional(),
    gravitySI: z.number().positive().default(9.80665),
    surfacePressureSI: z.number().positive().default(101325),
  }).prefault({}),

  mission: z.object({
    targetDepthSI: z.number().min(0).default(3),
    depthLimitSI: z.number().min(0).default(4),
    surfaceThresholdSI: z.number().min(0).default(0.2),
    cycles: z.number().int().min(1).default(4),
    bottomDwellSI: z.number().min(0).default(5),
    surfaceDwellSI: z.number().min(0).default(10),
    leakCheckTimeSI: z.number().min(0).default(30),
    initializationTimeSI: z.number().min(0).default(15),
    transmitTimeSI: z.number().min(0).default(5),
    currentVelocitySI: z.number().default(0),
    maxTimeSI: z.number().min(1).default(3600),
    dtSI: z.number().positive().default(0.2),
    velocityTimeConstantSI: z.number().min(0).default(0),
  }).prefault({}),

  vehicle: z.object({
    hullLengthSI: z.number().positive().default(0.6),
    hullDiameterSI: z.number().positive().default(0.09),
    hullWettedAreaSI: z.number().positive().optional(),
    wingAreaSI: z.number().min(0).default(0.012),
    wingAspectRatio: z.number().min(0).default(4),
    wingThicknessRatio: z.number().min(0).max(0.5).default(0.12),
    oswaldEfficiency: z.number().min(0.1).max(1).default(0.8),
    tailAreaSI: z.number().min(0).default(0.004),
    appendageDragAreaSI: z.number().min(0).default(0),
    maxLengthSI: z.number().positive().optional(),
    maxDiameterSI: z.number().positive().optional(),
    maxMassSI: z.number().positive().optional(),
  }).prefault({}),

  hydro: z.object({
    modelLevel: z.enum(["coefficient", "buildup", "experimental", "calibrated"]).default("buildup"),
    /** Reference area the coefficients are based on, m^2. */
    referenceAreaSI: z.number().positive().default(0.012),
    referenceAreaBasis: z.string().default("Total wing planform area"),
    liftCoefficient: z.number().default(0.35),
    dragCoefficient: z.number().positive().default(0.12),
    coefficientSource: z.enum(["user", "buildup", "experimental", "assumed"]).default("assumed"),
    coefficientNote: z.string().default(
      "Initial estimates entered as placeholders. They have NOT been measured for this vehicle and must be replaced by tow-test or glide-test values before any performance claim.",
    ),
    calibrationFactor: z.number().positive().default(1),
    angleOfAttackDeg: z.number().default(6),
  }).prefault({}),

  syringe: z.object({
    config: z.custom<EngineConfig>().default("external-plunger"),
    boreDiameterSI: z.number().positive().default(0.0286),
    plungerDiameterSI: z.number().positive().optional(),
    maxStrokeSI: z.number().min(0).default(0.09),
    usableStrokeSI: z.number().min(0).default(0.08),
    deadVolumeSI: z.number().min(0).default(0),
    syringeCount: z.number().int().min(1).default(1),
    frictionForceSI: z.number().min(0).optional(),
    mechanismEfficiency: z.number().min(0.01).max(1).default(0.9),
    leadSI: z.number().min(0).optional(),
    screwEfficiency: z.number().min(0.01).max(1).optional(),
    gearRatio: z.number().min(0.01).default(1),
    gearEfficiency: z.number().min(0.01).max(1).default(0.9),
    motorTorqueSI: z.number().min(0).optional(),
    motorSpeedSI: z.number().min(0).optional(),
    motorCurrentSI: z.number().min(0).optional(),
    supplyVoltageSI: z.number().min(0).optional(),
    safetyFactor: z.number().min(1).default(2),
    targetBuoyancyForceSI: z.number().min(0).optional(),
    combinedMassFraction: z.number().min(0).max(1).optional(),
    combinedVolumeFraction: z.number().min(0).max(1).optional(),
  }).prefault({}),

  structure: z.object({
    housingOuterDiameterSI: z.number().positive().optional(),
    housingWallThicknessSI: z.number().positive().optional(),
    housingLengthSI: z.number().positive().optional(),
    materialId: z.string().optional(),
    youngsModulusSI: z.number().positive().optional(),
    poissonsRatio: z.number().min(0).max(0.5).optional(),
    yieldStrengthSI: z.number().positive().optional(),
    materialProvenance: z.enum(["user", "reference", "assumed"]).default("assumed"),
    safetyFactor: z.number().min(1).default(2),
  }).prefault({}),

  battery: z.object({
    capacitySI: z.number().min(0).default(9000), // 2500 mAh in coulombs
    nominalVoltageSI: z.number().positive().default(11.1),
    usableFraction: z.number().min(0.05).max(1).default(0.8),
    deratingFactor: z.number().min(0.1).max(1).default(0.9),
    chemistry: z.string().default("Li-ion 3S"),
    provenance: z.enum(["datasheet", "measured", "estimated"]).default("estimated"),
  }).prefault({}),

  project: z.object({
    budgetUSD: z.number().min(0).optional(),
    manufacturingMethods: z.array(z.string()).default([]),
    availableEquipment: z.array(z.string()).default([]),
    advisorName: z.string().optional(),
    courseName: z.string().optional(),
    revision: z.string().default("A"),
  }).prefault({}),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export function parseSettings(json: string | null | undefined): ProjectSettings {
  try {
    return projectSettingsSchema.parse(JSON.parse(json || "{}"));
  } catch {
    return projectSettingsSchema.parse({});
  }
}

export const PROJECT_PHASES = [
  { id: "concept", label: "Concept definition", order: 1 },
  { id: "requirements", label: "Requirements", order: 2 },
  { id: "preliminary", label: "Preliminary design", order: 3 },
  { id: "detailed", label: "Detailed design", order: 4 },
  { id: "fabrication", label: "Fabrication and assembly", order: 5 },
  { id: "integration", label: "Integration and bench test", order: 6 },
  { id: "testing", label: "Water testing", order: 7 },
  { id: "refinement", label: "Refinement", order: 8 },
  { id: "reporting", label: "Reporting and presentation", order: 9 },
] as const;

export type ProjectPhaseId = (typeof PROJECT_PHASES)[number]["id"];
