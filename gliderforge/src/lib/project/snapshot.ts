import { computeBuoyancy, solveForNeutral } from "@/lib/calc/buoyancy";
import { computeMassProperties, type CalcComponent, type DisplacementMode } from "@/lib/calc/massprops";
import { computeStability } from "@/lib/calc/stability";
import { computeSyringeEngine, ARCHITECTURES } from "@/lib/calc/syringe";
import { computePowerBudget, type BatterySpec, type PowerLoad } from "@/lib/calc/power";
import { dragBuildup, glideEquilibrium } from "@/lib/calc/hydro";
import { waterDensity } from "@/lib/reference/water";
import type { CalcWarning } from "@/lib/calc/types";
import { parseSettings, type ProjectSettings } from "./settings";
import { listRows, type ProjectRow, type Row } from "@/lib/db/repo";

/**
 * The single derived model of a project.
 *
 * Every module and the assistant read this, which is what makes information
 * entered in one place appear consistently everywhere else. It is recomputed
 * on demand rather than cached, so it can never drift from the stored data.
 */

export interface ProjectSnapshot {
  project: ProjectRow;
  settings: ProjectSettings;
  water: {
    densitySI: number;
    source: string;
    warnings: CalcWarning[];
    isOverride: boolean;
  };
  components: Row[];
  calcComponents: CalcComponent[];
  massProps: ReturnType<typeof computeMassProperties>;
  buoyancy: ReturnType<typeof computeBuoyancy>;
  neutral: ReturnType<typeof solveForNeutral>;
  stability: ReturnType<typeof computeStability>;
  syringe: ReturnType<typeof computeSyringeEngine>;
  power: ReturnType<typeof computePowerBudget>;
  drag: ReturnType<typeof dragBuildup>;
  diveGlide: ReturnType<typeof glideEquilibrium>;
  climbGlide: ReturnType<typeof glideEquilibrium>;
  requirements: Row[];
  risks: Row[];
  tests: Row[];
  testRuns: Row[];
  decisions: Row[];
  assumptions: Row[];
  notebook: Row[];
  tasks: Row[];
  milestones: Row[];
  calculations: Row[];
  recommendations: Row[];
  geometryFiles: Row[];
  electronics: Row[];
  pins: Row[];
  variants: Row[];
  simulationsList: Row[];
  storedReports: Row[];
  assistantMessages: Row[];
  /** Aggregated, deduplicated warnings across every module. */
  warnings: { module: string; warning: CalcWarning }[];
  completion: CompletionReport;
}

export interface CompletionSection {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  weight: number;
}

export interface CompletionReport {
  percent: number;
  sections: CompletionSection[];
  requirementsVerified: number;
  requirementsTotal: number;
  openAssumptions: number;
  openRisks: number;
  unreviewedStarterRisks: number;
  pendingRecommendations: number;
}

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Effective mass: a measured value always supersedes an estimate, but the estimate is kept. */
export function effectiveMass(row: Row): { value?: number; provenance: "measured" | "estimated" | "unknown" } {
  const measured = num(row.measured_mass_kg);
  if (measured !== undefined) return { value: measured, provenance: "measured" };
  const estimated = num(row.estimated_mass_kg);
  if (estimated !== undefined) return { value: estimated, provenance: "estimated" };
  return { provenance: "unknown" };
}

export function effectiveVolume(row: Row): { value?: number; provenance: "measured" | "cad" | "user" | "unknown" } {
  const explicit = num(row.displaced_volume_m3);
  if (explicit !== undefined) return { value: explicit, provenance: "user" };
  const user = num(row.user_volume_m3);
  if (user !== undefined) return { value: user, provenance: "user" };
  const cad = num(row.cad_volume_m3);
  if (cad !== undefined) return { value: cad, provenance: "cad" };
  return { provenance: "unknown" };
}

export function toCalcComponent(row: Row): CalcComponent {
  const mass = effectiveMass(row);
  const volume = effectiveVolume(row);
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category ?? "other"),
    quantity: num(row.quantity) ?? 1,
    massSI: mass.value,
    massProvenance: mass.provenance === "unknown" ? "unknown" : mass.provenance,
    displacedVolumeSI: volume.value,
    volumeProvenance: volume.provenance,
    displacementMode: (String(row.displacement_mode ?? "internal") as DisplacementMode),
    position: { x: num(row.pos_x) ?? 0, y: num(row.pos_y) ?? 0, z: num(row.pos_z) ?? 0 },
    comOffset: { x: num(row.com_x) ?? 0, y: num(row.com_y) ?? 0, z: num(row.com_z) ?? 0 },
    includeInBudget: Number(row.include_in_budget ?? 1) === 1,
    confidence: (String(row.confidence ?? "medium") as "high" | "medium" | "low"),
  };
}

export function buildSnapshot(project: ProjectRow): ProjectSnapshot {
  const settings = parseSettings(project.settings_json);
  const pid = project.id;

  const components = listRows("components", pid, "name ASC");
  const requirements = listRows("requirements", pid, "key ASC");
  const risks = listRows("risks", pid, "key ASC");
  const tests = listRows("tests", pid, "key ASC");
  const testRuns = listRows("test_runs", pid);
  const decisions = listRows("decisions", pid);
  const assumptions = listRows("assumptions", pid);
  const notebook = listRows("notebook_entries", pid);
  const tasks = listRows("tasks", pid);
  const milestones = listRows("milestones", pid, "due_date ASC");
  const calculations = listRows("calculation_runs", pid);
  const recommendations = listRows("ai_recommendations", pid);
  const geometryFiles = listRows("geometry_files", pid);
  const electronics = listRows("electronics", pid, "name ASC");
  const pins = listRows("pin_assignments", pid, "created_at ASC");
  const variants = listRows("design_variants", pid);
  const simulationsList = listRows("simulations", pid);
  const storedReports = listRows("reports", pid);
  const assistantMessages = listRows("assistant_messages", pid, "created_at ASC");

  // --- water ---
  const env = settings.environment;
  let densitySI: number;
  let waterSource: string;
  let waterWarnings: CalcWarning[] = [];
  const isOverride = env.densityOverrideSI !== undefined;
  if (isOverride) {
    densitySI = env.densityOverrideSI as number;
    waterSource = env.densityOverrideSource || "User-entered density override";
  } else {
    const w = waterDensity({ temperatureC: env.temperatureC, salinityPSU: env.salinityPSU });
    densitySI = w.densitySI;
    waterWarnings = w.warnings;
    waterSource = `${w.correlation.name} at ${env.temperatureC} degC, ${env.salinityPSU} PSU`;
  }

  // --- mass properties and buoyancy ---
  const calcComponents = components.map(toCalcComponent);
  const massProps = computeMassProperties(calcComponents);
  const totalMass = massProps.values.totalMass.value;
  const totalVolume = massProps.values.totalDisplacedVolume.value;

  const buoyancy = computeBuoyancy({
    displacedVolumeSI: totalVolume,
    waterDensitySI: densitySI,
    massSI: totalMass,
    gravitySI: env.gravitySI,
  });
  const neutral = solveForNeutral({
    displacedVolumeSI: totalVolume,
    waterDensitySI: densitySI,
    massSI: totalMass,
    gravitySI: env.gravitySI,
  });
  const stability = computeStability({
    cg: massProps.cg,
    cb: massProps.cb,
    displacedVolumeSI: totalVolume,
    waterDensitySI: densitySI,
    massSI: totalMass,
    gravitySI: env.gravitySI,
  });

  // --- syringe ---
  const s = settings.syringe;
  const syringe = computeSyringeEngine({
    config: s.config,
    boreDiameterSI: s.boreDiameterSI,
    plungerDiameterSI: s.plungerDiameterSI,
    maxStrokeSI: s.maxStrokeSI,
    usableStrokeSI: s.usableStrokeSI,
    deadVolumeSI: s.deadVolumeSI,
    syringeCount: s.syringeCount,
    waterDensitySI: densitySI,
    gravitySI: env.gravitySI,
    depthSI: settings.mission.targetDepthSI,
    surfacePressureSI: env.surfacePressureSI,
    frictionForceSI: s.frictionForceSI,
    mechanismEfficiency: s.mechanismEfficiency,
    leadSI: s.leadSI,
    screwEfficiency: s.screwEfficiency,
    gearRatio: s.gearRatio,
    gearEfficiency: s.gearEfficiency,
    motorTorqueSI: s.motorTorqueSI,
    motorSpeedSI: s.motorSpeedSI,
    motorCurrentSI: s.motorCurrentSI,
    supplyVoltageSI: s.supplyVoltageSI,
    safetyFactor: s.safetyFactor,
    targetBuoyancyForceSI: s.targetBuoyancyForceSI,
    combinedMassFraction: s.combinedMassFraction,
    combinedVolumeFraction: s.combinedVolumeFraction,
  });

  // --- power ---
  const loads: PowerLoad[] = electronics
    .filter((e) => num(e.current_a) !== undefined && num(e.voltage_v) !== undefined)
    .map((e) => ({
      id: String(e.id),
      name: String(e.name),
      subsystem: mapSubsystem(String(e.kind)),
      currentSI: num(e.current_a) as number,
      voltageSI: num(e.voltage_v) as number,
      dutyCycle: num(e.duty_cycle) ?? 1,
      regulatorEfficiency: num(e.regulator_efficiency) ?? 1,
      provenance: (String(e.provenance ?? "estimated") as PowerLoad["provenance"]),
    }));
  const battery: BatterySpec = {
    capacitySI: settings.battery.capacitySI,
    nominalVoltageSI: settings.battery.nominalVoltageSI,
    usableFraction: settings.battery.usableFraction,
    deratingFactor: settings.battery.deratingFactor,
    chemistry: settings.battery.chemistry,
    provenance: settings.battery.provenance,
  };
  const power = computePowerBudget(loads, battery);

  // --- hydrodynamics ---
  const h = settings.hydro;
  const v = settings.vehicle;
  // Buoyancy authority sets the driving force for a glide.
  const authority = syringe.values.buoyancyForceChange.value / 2;
  const nominalSpeedGuess = 0.3;
  const drag = dragBuildup({
    velocitySI: nominalSpeedGuess,
    densitySI,
    temperatureC: env.temperatureC,
    hullLengthSI: v.hullLengthSI,
    hullDiameterSI: v.hullDiameterSI,
    hullWettedAreaSI: v.hullWettedAreaSI,
    wingAreaSI: v.wingAreaSI,
    wingAspectRatio: v.wingAspectRatio,
    wingThicknessRatio: v.wingThicknessRatio,
    oswaldEfficiency: v.oswaldEfficiency,
    tailAreaSI: v.tailAreaSI,
    liftCoefficient: h.liftCoefficient,
    appendageDragAreaSI: v.appendageDragAreaSI,
    calibrationFactor: h.calibrationFactor,
  });
  const diveGlide = glideEquilibrium({
    netBuoyancyForceSI: authority,
    densitySI,
    referenceAreaSI: h.referenceAreaSI,
    liftCoefficient: h.liftCoefficient,
    dragCoefficient: h.dragCoefficient,
    descending: true,
    coefficientSource: h.coefficientSource,
  });
  const climbGlide = glideEquilibrium({
    netBuoyancyForceSI: authority,
    densitySI,
    referenceAreaSI: h.referenceAreaSI,
    liftCoefficient: h.liftCoefficient,
    dragCoefficient: h.dragCoefficient,
    descending: false,
    coefficientSource: h.coefficientSource,
  });

  const warnings: { module: string; warning: CalcWarning }[] = [];
  const push = (module: string, list: CalcWarning[]) => {
    for (const w of list) warnings.push({ module, warning: w });
  };
  push("Water properties", waterWarnings);
  push("Mass properties", massProps.warnings);
  push("Buoyancy", buoyancy.warnings);
  push("Stability", stability.warnings);
  push("Syringe engine", syringe.warnings);
  push("Power budget", power.warnings);
  push("Hydrodynamics", drag.warnings);
  push("Glide (dive)", diveGlide.warnings);

  const completion = computeCompletion({
    components,
    requirements,
    tests,
    testRuns,
    risks,
    decisions,
    assumptions,
    geometryFiles,
    electronics,
    recommendations,
    settings,
    hasMass: massProps.missingMass.length === 0 && components.length > 0,
    hasVolume: massProps.missingVolume.length === 0,
  });

  return {
    project,
    settings,
    water: { densitySI, source: waterSource, warnings: waterWarnings, isOverride },
    components,
    calcComponents,
    massProps,
    buoyancy,
    neutral,
    stability,
    syringe,
    power,
    drag,
    diveGlide,
    climbGlide,
    requirements,
    risks,
    tests,
    testRuns,
    decisions,
    assumptions,
    notebook,
    tasks,
    milestones,
    calculations,
    recommendations,
    geometryFiles,
    electronics,
    pins,
    variants,
    simulationsList,
    storedReports,
    assistantMessages,
    warnings,
    completion,
  };
}

function mapSubsystem(kind: string): PowerLoad["subsystem"] {
  switch (kind) {
    case "microcontroller":
    case "controller":
      return "controller";
    case "motor":
    case "motor-driver":
    case "actuator":
      return "actuator";
    case "pressure-sensor":
    case "depth-sensor":
    case "imu":
    case "leak-sensor":
    case "limit-switch":
    case "sensor":
      return "sensor";
    case "radio":
    case "comms":
      return "comms";
    default:
      return "other";
  }
}

function computeCompletion(ctx: {
  components: Row[];
  requirements: Row[];
  tests: Row[];
  testRuns: Row[];
  risks: Row[];
  decisions: Row[];
  assumptions: Row[];
  geometryFiles: Row[];
  electronics: Row[];
  recommendations: Row[];
  settings: ProjectSettings;
  hasMass: boolean;
  hasVolume: boolean;
}): CompletionReport {
  const verified = ctx.requirements.filter((r) => String(r.verification_status) === "verified").length;
  const openAssumptions = ctx.assumptions.filter((a) => String(a.status) === "open").length;
  const openRisks = ctx.risks.filter((r) => String(r.status) !== "closed").length;
  const unreviewedStarter = ctx.risks.filter((r) => Number(r.is_starter) === 1 && Number(r.reviewed) === 0).length;
  const pendingRecs = ctx.recommendations.filter((r) => String(r.status) === "pending").length;

  const sections: CompletionSection[] = [
    {
      id: "requirements",
      label: "Requirements defined",
      done: ctx.requirements.length >= 5,
      detail: `${ctx.requirements.length} requirement(s) recorded`,
      weight: 1,
    },
    {
      id: "components",
      label: "Component inventory",
      done: ctx.components.length >= 5,
      detail: `${ctx.components.length} component(s)`,
      weight: 1,
    },
    {
      id: "mass",
      label: "Every component has a mass",
      done: ctx.hasMass,
      detail: ctx.hasMass ? "No missing masses" : "Some components have no mass entered",
      weight: 1.5,
    },
    {
      id: "volume",
      label: "Every water-exposed component has a volume",
      done: ctx.hasVolume,
      detail: ctx.hasVolume ? "No missing displacement volumes" : "Some displacement volumes are missing",
      weight: 1.5,
    },
    {
      id: "geometry",
      label: "Geometry uploaded",
      done: ctx.geometryFiles.length > 0,
      detail: `${ctx.geometryFiles.length} geometry file(s)`,
      weight: 0.5,
    },
    {
      id: "syringe",
      label: "Buoyancy engine sized with measured friction",
      done: ctx.settings.syringe.frictionForceSI !== undefined,
      detail:
        ctx.settings.syringe.frictionForceSI !== undefined
          ? "Plunger friction entered"
          : "Plunger friction not measured — the torque requirement is unreliable",
      weight: 1.5,
    },
    {
      id: "motor",
      label: "Drivetrain specified (lead, motor torque)",
      done: ctx.settings.syringe.leadSI !== undefined && ctx.settings.syringe.motorTorqueSI !== undefined,
      detail: "Lead screw and motor torque needed to size the actuator",
      weight: 1,
    },
    {
      id: "electronics",
      label: "Electrical loads listed",
      done: ctx.electronics.length >= 3,
      detail: `${ctx.electronics.length} electrical item(s)`,
      weight: 1,
    },
    {
      id: "hydro",
      label: "Hydrodynamic coefficients from test, not assumption",
      done: ctx.settings.hydro.coefficientSource === "experimental" || ctx.settings.hydro.coefficientSource === "user",
      detail: `Coefficient source: ${ctx.settings.hydro.coefficientSource}`,
      weight: 1,
    },
    {
      id: "tests",
      label: "Test plans written",
      done: ctx.tests.length >= 3,
      detail: `${ctx.tests.length} test plan(s)`,
      weight: 1,
    },
    {
      id: "testdata",
      label: "Test data recorded",
      done: ctx.testRuns.length > 0,
      detail: `${ctx.testRuns.length} test run(s)`,
      weight: 1.5,
    },
    {
      id: "verification",
      label: "Requirements verified",
      done: ctx.requirements.length > 0 && verified / ctx.requirements.length >= 0.8,
      detail: `${verified} of ${ctx.requirements.length} verified`,
      weight: 2,
    },
    {
      id: "decisions",
      label: "Design decisions recorded",
      done: ctx.decisions.length >= 2,
      detail: `${ctx.decisions.length} decision record(s)`,
      weight: 1,
    },
    {
      id: "risks",
      label: "Risk register reviewed",
      done: ctx.risks.length > 0 && unreviewedStarter === 0,
      detail: unreviewedStarter > 0 ? `${unreviewedStarter} starter risk(s) not yet reviewed` : `${ctx.risks.length} risk(s)`,
      weight: 1,
    },
    {
      id: "assumptions",
      label: "Assumptions resolved",
      done: ctx.assumptions.length > 0 && openAssumptions === 0,
      detail: `${openAssumptions} open assumption(s)`,
      weight: 1,
    },
  ];

  const totalWeight = sections.reduce((s, x) => s + x.weight, 0);
  const doneWeight = sections.filter((x) => x.done).reduce((s, x) => s + x.weight, 0);

  return {
    percent: totalWeight > 0 ? (doneWeight / totalWeight) * 100 : 0,
    sections,
    requirementsVerified: verified,
    requirementsTotal: ctx.requirements.length,
    openAssumptions,
    openRisks,
    unreviewedStarterRisks: unreviewedStarter,
    pendingRecommendations: pendingRecs,
  };
}

export const ARCHITECTURE_LABELS = ARCHITECTURES;
