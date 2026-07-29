import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { STATE_DESCRIPTIONS } from "@/lib/calc/mission";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { MissionWorkspace } from "@/components/pages/MissionWorkspace";

export const dynamic = "force-dynamic";

export default async function MissionPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  const authority = snap.syringe.values.buoyancyForceChange.value / 2;
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Mission simulator"
        subtitle="A transparent state machine stepped in time. Every transition is recorded with the reason for it, so the depth trace can be read alongside what the vehicle thought it was doing."
      />
      <MissionWorkspace
        projectId={snap.project.id}
        stateDescriptions={STATE_DESCRIPTIONS}
        defaults={{
          targetDepthSI: snap.settings.mission.targetDepthSI,
          depthLimitSI: snap.settings.mission.depthLimitSI,
          surfaceThresholdSI: snap.settings.mission.surfaceThresholdSI,
          cycles: snap.settings.mission.cycles,
          bottomDwellSI: snap.settings.mission.bottomDwellSI,
          surfaceDwellSI: snap.settings.mission.surfaceDwellSI,
          currentVelocitySI: snap.settings.mission.currentVelocitySI,
          velocityTimeConstantSI: snap.settings.mission.velocityTimeConstantSI,
          diveNetBuoyancySI: -Math.abs(authority),
          climbNetBuoyancySI: Math.abs(authority),
          actuationTimeSI: snap.syringe.values.actuationTime?.value ?? 10,
        }}
        context={{
          authorityN: authority * 2,
          batteryWh: snap.power.values.usableEnergy.value / 3600,
          hotelW: snap.power.values.hotelPower.value,
          actuatorW: snap.syringe.values.estimatedPower?.value ?? snap.power.values.actuatorPower.value,
          coefficientSource: snap.settings.hydro.coefficientSource,
          diveSpeed: snap.diveGlide.values.speed.value,
          glideRatio: snap.diveGlide.values.glideRatio.value,
        }}
        savedSimulations={snap.simulationsList}
      />
    </div>
  );
}
