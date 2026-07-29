import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { TEST_TEMPLATES } from "@/lib/sample/testTemplates";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { TestsClient } from "@/components/pages/TestsClient";

export const dynamic = "force-dynamic";

export default async function TestsPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Tests and data"
        subtitle="Plan tests, record runs, import raw data and compare measurements with predictions. Raw data is never modified; every exclusion or transformation is recorded separately with a reason."
      />
      <TestsClient
        projectId={snap.project.id}
        tests={snap.tests}
        runs={snap.testRuns}
        requirements={snap.requirements.map((r) => ({ id: String(r.id), key: String(r.key), title: String(r.title) }))}
        templates={TEST_TEMPLATES.map((t) => ({
          key: t.key,
          title: t.title,
          category: t.category,
          objective: t.objective,
          equipment: t.equipment,
          setup: t.setup,
          variables: t.variables,
          procedure: t.procedure,
          safety: t.safety,
          rawFields: t.rawFields,
          expected: t.expected,
          passCriteria: t.passCriteria,
          uncertaintySources: t.uncertaintySources,
        }))}
        predictions={{
          diveSpeedMS: snap.diveGlide.values.speed.value,
          verticalSpeedMS: Math.abs(snap.diveGlide.values.verticalSpeed.value),
          glideRatio: snap.diveGlide.values.glideRatio.value,
          buoyancyAuthorityN: snap.syringe.values.buoyancyForceChange.value,
          sweptVolumeCm3: snap.syringe.values.usableVolumeChange.value * 1e6,
          designForceN: snap.syringe.values.designActuatorForce.value,
          netBuoyancyN: snap.buoyancy.values.netBuoyantForce.value,
          totalMassKg: snap.massProps.values.totalMass.value,
          displacedVolumeCm3: snap.massProps.values.totalDisplacedVolume.value * 1e6,
          equilibriumPitchDeg: (snap.stability.values.equilibriumPitch.value * 180) / Math.PI,
          averagePowerW: snap.power.values.averagePower.value,
        }}
        calibrationFactor={snap.settings.hydro.calibrationFactor}
      />
    </div>
  );
}
