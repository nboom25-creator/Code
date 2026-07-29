import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { providerStatus } from "@/lib/assistant/provider";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { AssistantClient } from "@/components/pages/AssistantClient";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  const status = providerStatus();
  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Project assistant"
        subtitle="Answers come from your own project data, cite the exact values used, and say what is missing. Nothing here writes to your project without you accepting it."
      />
      <AssistantClient
        projectId={snap.project.id}
        provider={status}
        recommendations={snap.recommendations}
        history={snap.assistantMessages}
      />
    </div>
  );
}
