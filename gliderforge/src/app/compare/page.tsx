import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { CompareClient } from "@/components/pages/CompareClient";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Compare designs"
        subtitle="Evaluate candidate buoyancy-engine and hydrodynamic configurations side by side against the same vehicle, water and depth. Everything not varied is held identical, so the differences are attributable."
      />
      <CompareClient
        projectId={snap.project.id}
        variants={snap.variants}
        context={{
          waterDensitySI: snap.water.densitySI,
          gravitySI: snap.settings.environment.gravitySI,
          depthSI: snap.settings.mission.targetDepthSI,
          surfacePressureSI: snap.settings.environment.surfacePressureSI,
          vehicleWeightN: snap.buoyancy.values.weight.value,
          referenceAreaSI: snap.settings.hydro.referenceAreaSI,
          coefficientSource: snap.settings.hydro.coefficientSource,
          current: {
            config: snap.settings.syringe.config,
            boreDiameterSI: snap.settings.syringe.boreDiameterSI,
            maxStrokeSI: snap.settings.syringe.maxStrokeSI,
            usableStrokeSI: snap.settings.syringe.usableStrokeSI,
            syringeCount: snap.settings.syringe.syringeCount,
            frictionForceSI: snap.settings.syringe.frictionForceSI,
            mechanismEfficiency: snap.settings.syringe.mechanismEfficiency,
            leadSI: snap.settings.syringe.leadSI,
            screwEfficiency: snap.settings.syringe.screwEfficiency,
            gearRatio: snap.settings.syringe.gearRatio,
            gearEfficiency: snap.settings.syringe.gearEfficiency,
            motorTorqueSI: snap.settings.syringe.motorTorqueSI,
            motorSpeedSI: snap.settings.syringe.motorSpeedSI,
            motorCurrentSI: snap.settings.syringe.motorCurrentSI,
            supplyVoltageSI: snap.settings.syringe.supplyVoltageSI,
            safetyFactor: snap.settings.syringe.safetyFactor,
            liftCoefficient: snap.settings.hydro.liftCoefficient,
            dragCoefficient: snap.settings.hydro.dragCoefficient,
          },
        }}
      />
    </div>
  );
}
