import { createRow, getProject } from "@/lib/db/repo";
import { storeUpload, UploadError, GEOMETRY_EXTENSIONS, maxUploadBytes, ALLOWED_EXTENSIONS } from "@/lib/uploads";
import { parseGeometry, detectFormat } from "@/lib/geometry/parse";
import { readStored } from "@/lib/uploads";
import { ok, fail, handleError, sanitizeText } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Advertise the limits so the client can validate before uploading. */
export async function GET() {
  return ok({
    maxBytes: maxUploadBytes(),
    allowedExtensions: [...ALLOWED_EXTENSIONS].sort(),
    geometryExtensions: [...GEOMETRY_EXTENSIONS].sort(),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getProject(id)) return fail("Project not found.", 404);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("No file was included in the request.", 400);

    const componentId = sanitizeText(form.get("componentId") ?? undefined, 100) || null;
    const unit = sanitizeText(form.get("unit") ?? "mm", 12) || "mm";
    const description = sanitizeText(form.get("description") ?? undefined, 1000) || null;

    const stored = await storeUpload(file);
    const format = detectFormat(stored.originalName);

    if (GEOMETRY_EXTENSIONS.has(stored.extension)) {
      const buffer = await readStored(stored.storedName);
      const parsed = await parseGeometry(stored.originalName, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
      // The mesh itself is not persisted in the row — it is re-parsed on demand
      // from the stored file, so the database stays small and the analysis can
      // never drift from the file it describes.
      const { mesh: _mesh, ...summary } = parsed;
      const row = createRow("geometry_files", id, {
        component_id: componentId,
        filename: stored.originalName,
        stored_name: stored.storedName,
        size_bytes: stored.sizeBytes,
        mime: stored.mime,
        format,
        unit,
        parse_json: JSON.stringify(summary),
        uploaded_at: new Date().toISOString(),
      });
      return ok({ kind: "geometry", row, parse: summary }, 201);
    }

    const row = createRow("attachments", id, {
      entity_type: (sanitizeText(form.get("entityType") ?? "project", 40) || "project"),
      entity_id: sanitizeText(form.get("entityId") ?? undefined, 100) || null,
      filename: stored.originalName,
      stored_name: stored.storedName,
      size_bytes: stored.sizeBytes,
      mime: stored.mime,
      description,
      uploaded_at: new Date().toISOString(),
    });
    return ok({ kind: "attachment", row }, 201);
  } catch (e) {
    if (e instanceof UploadError) return fail(e.message, e.status);
    return handleError(e, "POST upload");
  }
}
