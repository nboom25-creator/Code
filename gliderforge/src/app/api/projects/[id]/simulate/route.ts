import { z } from "zod";
import { getProject, createRow } from "@/lib/db/repo";
import { buildSnapshot } from "@/lib/project/snapshot";
import { simulateMission } from "@/lib/calc/mission";
import { ok, fail, handleError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const overrideSchema = z
  .object({
    targetDepthSI: z.number().min(0).max(1000).optional(),
    depthLimitSI: z.number().min(0).max(1000).optional(),
    surfaceThresholdSI: z.number().min(0).max(100).optional(),
    cycles: z.number().int().min(1).max(500).optional(),
    bottomDwellSI: z.number().min(0).max(3600).optional(),
    surfaceDwellSI: z.number().min(0).max(3600).optional(),
    currentVelocitySI: z.number().min(-5).max(5).optional(),
    velocityTimeConstantSI: z.number().min(0).max(120).optional(),
    maxTimeSI: z.number().min(1).max(200000).optional(),
    dtSI: z.number().min(0.001).max(10).optional(),
    diveNetBuoyancySI: z.number().min(-100).max(0).optional(),
    climbNetBuoyancySI: z.number().min(0).max(100).optional(),
    actuationTimeSI: z.number().min(0).max(3600).optional(),
    save: z.boolean().optional(),
    name: z.string().max(120).optional(),
  })
  .default({});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = getProject(id);
    if (!project) return fail("Project not found.", 404);

    const body = overrideSchema.parse(await readJson(req));
    const snap = buildSnapshot(project);
    const m = snap.settings.mission;

    // Half the engine's authority in each direction from neutral is the
    // default operating assumption; the user can override it explicitly.
    const authority = snap.syringe.values.buoyancyForceChange.value / 2;

    const input = {
      dtSI: body.dtSI ?? m.dtSI,
      maxTimeSI: body.maxTimeSI ?? m.maxTimeSI,
      initialDepthSI: 0,
      targetDepthSI: body.targetDepthSI ?? m.targetDepthSI,
      surfaceThresholdSI: body.surfaceThresholdSI ?? m.surfaceThresholdSI,
      cycles: body.cycles ?? m.cycles,
      diveNetBuoyancySI: body.diveNetBuoyancySI ?? -Math.abs(authority),
      climbNetBuoyancySI: body.climbNetBuoyancySI ?? Math.abs(authority),
      waterDensitySI: snap.water.densitySI,
      referenceAreaSI: snap.settings.hydro.referenceAreaSI,
      liftCoefficient: snap.settings.hydro.liftCoefficient,
      dragCoefficient: snap.settings.hydro.dragCoefficient,
      actuationTimeSI: body.actuationTimeSI ?? snap.syringe.values.actuationTime?.value ?? 10,
      bottomDwellSI: body.bottomDwellSI ?? m.bottomDwellSI,
      surfaceDwellSI: body.surfaceDwellSI ?? m.surfaceDwellSI,
      leakCheckTimeSI: m.leakCheckTimeSI,
      initializationTimeSI: m.initializationTimeSI,
      transmitTimeSI: m.transmitTimeSI,
      currentVelocitySI: body.currentVelocitySI ?? m.currentVelocitySI,
      batteryEnergySI: snap.power.values.usableEnergy.value,
      hotelPowerSI: snap.power.values.hotelPower.value,
      actuatorPowerSI: snap.syringe.values.estimatedPower?.value ?? snap.power.values.actuatorPower.value,
      transmitPowerSI: 0.4,
      sensorPowerSI: 0.05,
      depthLimitSI: body.depthLimitSI ?? m.depthLimitSI,
      velocityTimeConstantSI: body.velocityTimeConstantSI ?? m.velocityTimeConstantSI,
    };

    const result = simulateMission(input);

    if (body.save) {
      createRow("simulations", id, {
        kind: "mission",
        name: body.name ?? `Mission run ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
        inputs_json: JSON.stringify(input),
        summary_json: JSON.stringify(result.summary),
        // Decimate long runs so a saved simulation stays a reasonable size.
        samples_json: JSON.stringify(result.samples.filter((_, i) => i % Math.max(1, Math.ceil(result.samples.length / 3000)) === 0)),
      });
      createRow("calculation_runs", id, {
        calc_id: "mission.simulate",
        title: "Mission simulation",
        inputs_json: JSON.stringify(input),
        results_json: JSON.stringify(result.summary),
        warnings_json: JSON.stringify(result.warnings),
        assumptions_json: JSON.stringify(result.assumptions.map((t) => ({ text: t, basis: "Mission simulator model assumption" }))),
        confidence: "low",
      });
    }

    return ok({ input, result });
  } catch (e) {
    return handleError(e, "POST simulate");
  }
}
