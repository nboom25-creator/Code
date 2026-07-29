import { getRow, updateRow, deleteRow, getProject } from "@/lib/db/repo";
import { ok, fail, handleError, readJson, sanitizePayload } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ table: string; rowId: string }> }) {
  try {
    const { table, rowId } = await params;
    const row = getRow(table, rowId);
    if (!row) return fail("Record not found.", 404);
    return ok({ row });
  } catch (e) {
    return handleError(e, "GET record");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; table: string; rowId: string }> }) {
  try {
    const { id, table, rowId } = await params;
    if (!getProject(id)) return fail("Project not found.", 404);
    const body = (await readJson(req)) as Record<string, unknown>;
    const row = updateRow(table, rowId, sanitizePayload(body));
    return ok({ row });
  } catch (e) {
    return handleError(e, "PATCH record");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ table: string; rowId: string }> }) {
  try {
    const { table, rowId } = await params;
    deleteRow(table, rowId);
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e, "DELETE record");
  }
}
