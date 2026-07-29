import { z } from "zod";
import { getProject, updateProject, deleteProject } from "@/lib/db/repo";
import { ok, fail, handleError, readJson, sanitizeText } from "@/lib/api";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  phase: z.string().max(40).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = getProject(id);
    if (!project) return fail("Project not found.", 404);
    return ok({ project });
  } catch (e) {
    return handleError(e, "GET /api/projects/[id]");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getProject(id)) return fail("Project not found.", 404);
    const body = patchSchema.parse(await readJson(req));
    const project = updateProject(id, {
      name: sanitizeText(body.name),
      description: sanitizeText(body.description),
      phase: body.phase,
    });
    return ok({ project });
  } catch (e) {
    return handleError(e, "PATCH /api/projects/[id]");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getProject(id)) return fail("Project not found.", 404);
    deleteProject(id);
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e, "DELETE /api/projects/[id]");
  }
}
