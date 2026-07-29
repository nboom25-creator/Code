import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { REPORT_CATALOG } from "@/lib/reports/generate";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { ReportsClient } from "@/components/pages/ReportsClient";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  const CSV_KINDS = new Set(["mass-budget", "requirements", "traceability", "risk-register", "bom", "power-budget", "test-plans"]);
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Reports and deliverables"
        subtitle="Every report carries the project name, revision, date, the units and water properties used, the equations, the assumptions, the warnings and the verification status. Nothing is generated that your data does not support."
      />
      <ReportsClient
        projectId={snap.project.id}
        projectName={snap.project.name}
        revision={snap.settings.project.revision}
        catalog={REPORT_CATALOG.map((r) => ({ ...r, csv: CSV_KINDS.has(r.kind) }))}
        stored={snap.storedReports}
      />
    </div>
  );
}
