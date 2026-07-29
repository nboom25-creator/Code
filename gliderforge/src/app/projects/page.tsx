import { listProjects } from "@/lib/db/repo";
import { getActiveProject } from "@/lib/project/session";
import { PageHeader } from "@/components/ui";
import { ProjectManager } from "@/components/pages/ProjectManager";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = listProjects();
  const active = await getActiveProject();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Projects"
        subtitle="Each project is a self-contained workspace: its own requirements, components, calculations, tests and settings. Data is stored locally in SQLite and survives closing the browser."
      />
      <ProjectManager
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          phase: p.phase,
          is_sample: p.is_sample,
          updated_at: p.updated_at,
        }))}
        activeId={active?.id ?? null}
      />
    </div>
  );
}
