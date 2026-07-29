import { getProject, updateProject } from "@/lib/db/repo";
import { projectSettingsSchema } from "@/lib/project/settings";
import { ok, fail, handleError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = getProject(id);
    if (!project) return fail("Project not found.", 404);
    // Full validation server-side: the browser is never trusted with the
    // engineering context that every module reads.
    const settings = projectSettingsSchema.parse(await readJson(req));
    const updated = updateProject(id, { settings_json: JSON.stringify(settings) });
    return ok({ project: updated, settings });
  } catch (e) {
    return handleError(e, "PUT settings");
  }
}
