import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { NotebookClient } from "@/components/pages/NotebookClient";

export const dynamic = "force-dynamic";

export default async function NotebookPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Engineering notebook"
        subtitle="Chronological record of what you did, what you decided and what you still do not know. The questions you log here become the discussion section of your report."
        actions={
          <a className="gf-btn" href={`/api/projects/${snap.project.id}/reports/notebook?download=1`}>
            Export notebook
          </a>
        }
      />
      <NotebookClient projectId={snap.project.id} rows={snap.notebook} requirements={snap.requirements.map((r) => ({ id: String(r.id), key: String(r.key), title: String(r.title) }))} />
    </div>
  );
}
