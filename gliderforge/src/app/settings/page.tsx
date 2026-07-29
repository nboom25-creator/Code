import Link from "next/link";
import { getActiveProject } from "@/lib/project/session";
import { parseSettings } from "@/lib/project/settings";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { SettingsEditor } from "@/components/pages/SettingsEditor";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const project = await getActiveProject();
  if (!project) {
    return <EmptyState title="No project selected" body={<>Create or open a project first.</>} action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  const settings = parseSettings(project.settings_json);
  return (
    <div className="mx-auto max-w-6xl">
      {project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Settings"
        subtitle="The shared engineering context. Anything set here is used by every module, which is what keeps the buoyancy budget, the syringe sizing, the stability check and the mission simulation consistent with each other. Changes autosave."
      />
      <SettingsEditor projectId={project.id} initial={settings} isSample={project.is_sample === 1} />
    </div>
  );
}
