import { listRows, createRow, getProject } from "@/lib/db/repo";
import { ok, fail, handleError, readJson, sanitizePayload } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; table: string }> }) {
  try {
    const { id, table } = await params;
    if (!getProject(id)) return fail("Project not found.", 404);
    return ok({ rows: listRows(table, id) });
  } catch (e) {
    return handleError(e, "GET collection");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; table: string }> }) {
  try {
    const { id, table } = await params;
    if (!getProject(id)) return fail("Project not found.", 404);
    const body = (await readJson(req)) as Record<string, unknown>;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return fail("Expected a JSON object.", 400);
    }
    const row = createRow(table, id, sanitizePayload(body));
    return ok({ row }, 201);
  } catch (e) {
    return handleError(e, "POST collection");
  }
}
