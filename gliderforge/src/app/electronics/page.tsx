import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { ElectronicsClient } from "@/components/pages/ElectronicsClient";

export const dynamic = "force-dynamic";

export default async function ElectronicsPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Electronics and controls"
        subtitle="Loads, pin assignments, power budget, control strategy and the predeployment checklist."
      />
      <ElectronicsClient
        projectId={snap.project.id}
        electronics={snap.electronics}
        pins={snap.pins}
        power={{
          averageW: snap.power.values.averagePower.value,
          peakW: snap.power.values.peakPower.value,
          hotelW: snap.power.values.hotelPower.value,
          actuatorW: snap.power.values.actuatorPower.value,
          usableJ: snap.power.values.usableEnergy.value,
          enduranceS: snap.power.values.enduranceTime.value,
          breakdown: snap.power.breakdown,
          warnings: snap.power.warnings,
          steps: snap.power.steps,
          assumptions: snap.power.assumptions,
          limitations: snap.power.limitations ?? [],
        }}
        battery={snap.settings.battery}
        syringe={{
          actuationTimeS: snap.syringe.values.actuationTime?.value,
          energyPerStrokeJ: snap.syringe.values.electricalEnergyPerStroke?.value,
          config: snap.settings.syringe.config,
        }}
      />
    </div>
  );
}
