import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { sweepSyringe, ARCHITECTURES, leadScrewTorque } from "@/lib/calc/syringe";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { SyringeWorkspace } from "@/components/pages/SyringeWorkspace";

export const dynamic = "force-dynamic";

export default async function SyringePage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return (
      <EmptyState
        title="No project selected"
        body="Create or open a project first."
        action={
          <Link href="/projects" className="gf-btn gf-btn-primary">
            Go to projects
          </Link>
        }
      />
    );
  }

  const s = snap.settings.syringe;
  const base = {
    config: s.config,
    boreDiameterSI: s.boreDiameterSI,
    plungerDiameterSI: s.plungerDiameterSI,
    maxStrokeSI: s.maxStrokeSI,
    usableStrokeSI: s.usableStrokeSI,
    deadVolumeSI: s.deadVolumeSI,
    syringeCount: s.syringeCount,
    waterDensitySI: snap.water.densitySI,
    gravitySI: snap.settings.environment.gravitySI,
    depthSI: snap.settings.mission.targetDepthSI,
    surfacePressureSI: snap.settings.environment.surfacePressureSI,
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
  };

  const boreValues = Array.from({ length: 13 }, (_, i) => 0.008 + i * 0.004); // 8 mm .. 56 mm
  const strokeValues = Array.from({ length: 13 }, (_, i) => 0.01 + i * 0.015); // 10 mm .. 190 mm
  const depthValues = Array.from({ length: 13 }, (_, i) => i * Math.max(1, snap.settings.mission.targetDepthSI / 4));

  const screwDetail =
    s.leadSI !== undefined
      ? leadScrewTorque({
          loadSI: snap.syringe.values.designActuatorForce.value,
          leadSI: s.leadSI,
          meanDiameterSI: 0.008,
          frictionCoefficient: 0.15,
          threadHalfAngle: (15 * Math.PI) / 180,
        })
      : null;

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Syringe buoyancy engine"
        subtitle="Bore diameter enters twice: swept volume scales with D², and so does the pressure force on the plunger. A wider syringe never buys authority for free."
      />
      <SyringeWorkspace
        projectId={snap.project.id}
        architecture={ARCHITECTURES[s.config]}
        result={{
          values: snap.syringe.values,
          steps: snap.syringe.steps,
          assumptions: snap.syringe.assumptions,
          warnings: snap.syringe.warnings,
          limitations: snap.syringe.limitations ?? [],
          confidence: snap.syringe.confidence,
          inputs: snap.syringe.inputs,
        }}
        sweeps={{
          bore: sweepSyringe(base, "boreDiameterSI", boreValues),
          stroke: sweepSyringe(base, "maxStrokeSI", strokeValues),
          depth: sweepSyringe(base, "depthSI", depthValues),
        }}
        screwDetail={screwDetail}
        settings={{
          boreMm: s.boreDiameterSI * 1000,
          strokeMm: s.usableStrokeSI * 1000,
          maxStrokeMm: s.maxStrokeSI * 1000,
          depthM: snap.settings.mission.targetDepthSI,
          frictionEntered: s.frictionForceSI !== undefined,
          screwEfficiencyEntered: s.screwEfficiency !== undefined,
          syringeCount: s.syringeCount,
        }}
        vehicleWeightN={snap.buoyancy.values.weight.value}
        waterDensity={snap.water.densitySI}
        gravity={snap.settings.environment.gravitySI}
      />
    </div>
  );
}
