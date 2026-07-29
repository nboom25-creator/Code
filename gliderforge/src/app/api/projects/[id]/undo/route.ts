import { undoLast, recentRevisions, getProject } from "@/lib/db/repo";
import { ok, fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok({ revisions: recentRevisions(id, 30) });
  } catch (e) {
    return handleError(e, "GET undo history");
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getProject(id)) return fail("Project not found.", 404);
    return ok(undoLast(id));
  } catch (e) {
    return handleError(e, "POST undo");
  }
}
