import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner, Card, Badge } from "@/components/ui";
import { RequirementsClient } from "@/components/pages/RequirementsClient";

export const dynamic = "force-dynamic";

export default async function RequirementsPage() {
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

  const verified = snap.requirements.filter((r) => String(r.verification_status) === "verified").length;

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Requirements"
        subtitle="What the design has to achieve, where each requirement came from, and how it will be shown to be met. This is what the traceability matrix in your report is built from."
        actions={
          <>
            <Badge tone={verified === snap.requirements.length && snap.requirements.length > 0 ? "good" : "warning"}>
              {verified} / {snap.requirements.length} verified
            </Badge>
            <Link href="/reports" className="gf-btn">
              Traceability matrix
            </Link>
          </>
        }
      />

      <Card title="Guidance" subtitle="A requirement that cannot be verified is a wish.">
        <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-muted">
          <li>
            <strong className="text-ink">Give every requirement a source.</strong> &ldquo;The tank is 3.5 m deep&rdquo; is a source.
            &ldquo;It seemed reasonable&rdquo; is not, and a reviewer will ask.
          </li>
          <li>
            <strong className="text-ink">Separate given from derived.</strong> Operating depth is given by the facility; buoyancy authority
            is derived from a target vertical speed. If the target changes, everything derived from it has to be re-derived.
          </li>
          <li>
            <strong className="text-ink">Choose the verification method honestly.</strong> Analysis is cheap and weak; test is expensive and
            strong. Anything safety-relevant needs a test.
          </li>
          <li>
            <strong className="text-ink">Link a test before you claim verification.</strong> A status without evidence is a claim, not proof.
          </li>
        </ul>
      </Card>

      <RequirementsClient
        projectId={snap.project.id}
        rows={snap.requirements}
        tests={snap.tests.map((t) => ({ id: String(t.id), key: String(t.key), title: String(t.title) }))}
        components={snap.components.map((c) => ({ id: String(c.id), name: String(c.name) }))}
      />
    </div>
  );
}
