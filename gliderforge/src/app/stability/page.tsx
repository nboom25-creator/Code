import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { StabilityWorkspace } from "@/components/pages/StabilityWorkspace";

export const dynamic = "force-dynamic";

export default async function StabilityPage() {
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

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Stability and trim"
        subtitle="A submerged vehicle has no waterplane, so there is no metacentre. Its entire righting moment comes from the centre of buoyancy sitting above the centre of gravity."
      />
      <StabilityWorkspace
        projectId={snap.project.id}
        cg={snap.massProps.cg}
        cb={snap.massProps.cb}
        totalMassSI={snap.massProps.values.totalMass.value}
        displacedVolumeSI={snap.massProps.values.totalDisplacedVolume.value}
        waterDensitySI={snap.water.densitySI}
        gravitySI={snap.settings.environment.gravitySI}
        stability={{
          values: snap.stability.values,
          steps: snap.stability.steps,
          assumptions: snap.stability.assumptions,
          warnings: snap.stability.warnings,
          limitations: snap.stability.limitations ?? [],
          confidence: snap.stability.confidence,
          inputs: snap.stability.inputs,
        }}
        components={snap.components.map((c) => ({
          id: String(c.id),
          name: String(c.name),
          massSI: Number(c.measured_mass_kg ?? c.estimated_mass_kg ?? 0) * Number(c.quantity ?? 1),
          positionX: Number(c.pos_x ?? 0),
          positionY: Number(c.pos_y ?? 0),
          positionZ: Number(c.pos_z ?? 0),
          movable: Number(c.movable ?? 0) === 1,
          minX: c.min_x === null || c.min_x === undefined ? null : Number(c.min_x),
          maxX: c.max_x === null || c.max_x === undefined ? null : Number(c.max_x),
          displacementMode: String(c.displacement_mode ?? "internal"),
          includeInBudget: Number(c.include_in_budget ?? 1) === 1,
        }))}
        syringe={{
          config: snap.settings.syringe.config,
          volumeChangeSI: snap.syringe.values.usableVolumeChange.value,
          changesMass: snap.settings.syringe.config === "internal-ballast" || snap.settings.syringe.config === "combined",
        }}
      />
    </div>
  );
}
