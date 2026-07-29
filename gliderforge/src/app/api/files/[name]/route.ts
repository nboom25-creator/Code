import { readStored, mimeFor, UploadError } from "@/lib/uploads";
import { fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Serve a stored upload. The name is resolved through resolveStoredPath, which
 * refuses anything outside the upload directory. Content-Disposition is set to
 * `inline` only for types the browser renders safely; SVG is forced to download
 * because an inline SVG can carry script.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const buffer = await readStored(decodeURIComponent(name));
    const mime = mimeFor(name);
    const inlineSafe = mime.startsWith("image/") && mime !== "image/svg+xml";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": mime === "image/svg+xml" ? "application/octet-stream" : mime,
        "content-disposition": `${inlineSafe || mime === "application/pdf" ? "inline" : "attachment"}; filename="${name.replace(/"/g, "")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof UploadError) return fail(e.message, e.status);
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return fail("File not found.", 404);
    return handleError(e, "GET file");
  }
}
