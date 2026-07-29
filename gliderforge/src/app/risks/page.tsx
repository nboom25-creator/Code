import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner, Card, Badge } from "@/components/ui";
import { RisksClient } from "@/components/pages/RisksClient";

export const dynamic = "force-dynamic";

export default async function RisksPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  const unreviewed = snap.risks.filter((r) => Number(r.is_starter) === 1 && Number(r.reviewed) === 0).length;
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Risk register"
        subtitle="Risk priority number = likelihood x severity x detectability, each scored 1-5. Higher detectability score means harder to detect, so a risk you cannot see coming scores worse."
        actions={<Badge tone={unreviewed > 0 ? "warning" : "good"}>{unreviewed > 0 ? `${unreviewed} starter risks not reviewed` : "all reviewed"}</Badge>}
      />
      {unreviewed > 0 && (
        <Card title="These are starter examples, not your assessment">
          <p className="text-xs leading-relaxed text-muted">
            {unreviewed} risk(s) were pre-populated from failure modes that recur in student underwater-vehicle projects. Until you edit each
            one for your vehicle, score it, assign an owner and mark it reviewed, it is a template. Do not present an unreviewed register at a
            design review as if the team had assessed it &mdash; and the scores that came with it are placeholders chosen to give a sensible
            starting order, not an assessment of your design.
          </p>
        </Card>
      )}
      <RisksClient projectId={snap.project.id} rows={snap.risks} />
    </div>
  );
}
