/** Upload validation — pure, testable rules shared by the route and tests. */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export const ALLOWED_TEXT = new Set(["text/plain", "text/csv", "text/markdown", "application/csv"]);
export const ALLOWED_IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const ALLOWED_PDF = new Set(["application/pdf"]);

export type UploadKind = "text" | "image" | "pdf" | "rejected";

export function classifyUpload(mime: string, size: number): { kind: UploadKind; reason?: string } {
  if (size > MAX_UPLOAD_BYTES) {
    return { kind: "rejected", reason: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.` };
  }
  if (size <= 0) return { kind: "rejected", reason: "Empty file." };
  if (ALLOWED_TEXT.has(mime)) return { kind: "text" };
  if (ALLOWED_IMAGE.has(mime)) return { kind: "image" };
  if (ALLOWED_PDF.has(mime)) return { kind: "pdf" };
  return { kind: "rejected", reason: `Unsupported file type: ${mime || "unknown"}.` };
}
