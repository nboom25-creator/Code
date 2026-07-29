import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner, Card } from "@/components/ui";
import { AssumptionsClient } from "@/components/pages/AssumptionsClient";

export const dynamic = "force-dynamic";

export default async function AssumptionsPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  const modelAssumptions = [
    ...snap.buoyancy.assumptions.map((a) => ({ ...a, module: "Buoyancy" })),
    ...snap.massProps.assumptions.map((a) => ({ ...a, module: "Mass properties" })),
    ...snap.stability.assumptions.map((a) => ({ ...a, module: "Stability" })),
    ...snap.syringe.assumptions.map((a) => ({ ...a, module: "Syringe engine" })),
    ...snap.drag.assumptions.map((a) => ({ ...a, module: "Hydrodynamics" })),
    ...snap.diveGlide.assumptions.map((a) => ({ ...a, module: "Glide" })),
    ...snap.power.assumptions.map((a) => ({ ...a, module: "Power" })),
  ];
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Assumptions"
        subtitle="Two kinds live here: assumptions you have recorded and must resolve, and the assumptions the models themselves make. Confirming the first kind is how a design conclusion becomes defensible."
      />
      <AssumptionsClient projectId={snap.project.id} rows={snap.assumptions} />
      <Card
        title="Assumptions built into the active models"
        subtitle="These come from the calculation engine itself and are reproduced on every report. They cannot be edited, only understood - and, where they do not fit your vehicle, worked around."
      >
        <div className="gf-scroll-x">
          <table className="gf-table">
            <thead>
              <tr>
                <th style={{ width: "12%" }}>Module</th>
                <th>Assumption</th>
                <th style={{ width: "45%" }}>Basis and consequence</th>
              </tr>
            </thead>
            <tbody>
              {modelAssumptions.map((a, i) => (
                <tr key={i}>
                  <td className="text-[11px] text-muted">{a.module}</td>
                  <td className="text-xs font-medium">{a.text}</td>
                  <td className="text-[11px] text-muted">{a.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
