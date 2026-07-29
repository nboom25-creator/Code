import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner, Card } from "@/components/ui";
import { DecisionsClient } from "@/components/pages/DecisionsClient";

export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Design decisions"
        subtitle="Why you chose what you chose. A design review is largely a series of questions about these, and they are far easier to write down now than to reconstruct in April."
      />
      <Card title="Weighted decision matrices">
        <p className="text-xs leading-relaxed text-muted">
          Each decision can carry a weighted matrix: criteria with weights, alternatives with scores. The tool computes the weighted totals
          and runs a sensitivity check &mdash; if a small change in the weights flips the winner, it says so. A matrix whose result depends on
          the third decimal place of a weight is not evidence, it is decoration.
        </p>
      </Card>
      <DecisionsClient projectId={snap.project.id} rows={snap.decisions} />
    </div>
  );
}
