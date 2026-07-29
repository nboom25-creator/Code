import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner, Card } from "@/components/ui";
import { ComponentsClient } from "@/components/pages/ComponentsClient";
import { MATERIALS } from "@/lib/reference/materials";

export const dynamic = "force-dynamic";

export default async function ComponentsPage() {
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
        title="Components"
        subtitle="The vehicle inventory. Mass, displacement, position and material entered here feed the buoyancy budget, the CG/CB calculation, the stability check and the bill of materials."
      />

      <Card title="The displacement mode is the important field" subtitle="Getting it wrong is the most common cause of a wrong buoyancy budget.">
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-2">
            <div className="font-semibold">hull</div>
            <p className="mt-0.5 leading-snug text-muted">The pressure envelope itself. Its EXTERNAL envelope volume displaces water and is usually the dominant term.</p>
          </div>
          <div className="rounded border p-2">
            <div className="font-semibold">external</div>
            <p className="mt-0.5 leading-snug text-muted">Mounted outside the hull and wetted. Displaces its own external volume.</p>
          </div>
          <div className="rounded border p-2">
            <div className="font-semibold">internal</div>
            <p className="mt-0.5 leading-snug text-muted">Inside a sealed hull. Contributes mass only — the hull envelope already accounts for its volume, so counting it again double-counts displacement.</p>
          </div>
          <div className="rounded border p-2">
            <div className="font-semibold">flooded</div>
            <p className="mt-0.5 leading-snug text-muted">In a free-flooding bay. Displaces only its own solid volume; water fills the space around it.</p>
          </div>
        </div>
      </Card>

      <ComponentsClient
        projectId={snap.project.id}
        rows={snap.components}
        geometryFiles={snap.geometryFiles}
        materials={MATERIALS.map((m) => ({ id: m.id, name: m.name, density: m.density.value }))}
        waterDensity={snap.water.densitySI}
      />
    </div>
  );
}
