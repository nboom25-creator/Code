import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { safeFilename } from "./api";

/**
 * Upload handling.
 *
 * Rules enforced here:
 *  - a whitelist of extensions and a size cap read from the environment,
 *  - the stored name is generated server-side (random prefix + sanitised base),
 *    so a user-supplied name can never influence the path,
 *  - the resolved path is checked to be inside the upload directory before any
 *    read or write, which closes path traversal even if the checks above are
 *    changed later.
 */

export const ALLOWED_EXTENSIONS = new Set([
  "stl", "step", "stp", "iges", "igs", "obj", "3mf",
  "csv", "json", "txt", "md",
  "png", "jpg", "jpeg", "gif", "webp", "svg",
  "pdf",
]);

export const GEOMETRY_EXTENSIONS = new Set(["stl", "step", "stp", "iges", "igs", "obj", "3mf"]);

const MIME_BY_EXT: Record<string, string> = {
  stl: "model/stl",
  obj: "model/obj",
  step: "model/step",
  stp: "model/step",
  iges: "model/iges",
  igs: "model/iges",
  "3mf": "model/3mf",
  csv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export function uploadDir(): string {
  const configured = process.env.GLIDERFORGE_UPLOAD_DIR ?? "./data/uploads";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function maxUploadBytes(): number {
  const n = Number(process.env.GLIDERFORGE_MAX_UPLOAD_BYTES ?? 26_214_400);
  return Number.isFinite(n) && n > 0 ? n : 26_214_400;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop()! : "";
}

export function mimeFor(filename: string): string {
  return MIME_BY_EXT[extensionOf(filename)] ?? "application/octet-stream";
}

/** Resolve a stored name to an absolute path, refusing anything outside the dir. */
export function resolveStoredPath(storedName: string): string {
  const dir = uploadDir();
  const resolved = path.resolve(dir, path.basename(storedName));
  const normalisedDir = path.resolve(dir) + path.sep;
  if (!resolved.startsWith(normalisedDir)) {
    throw new UploadError("Refusing to access a path outside the upload directory.", 400);
  }
  return resolved;
}

export interface StoredUpload {
  originalName: string;
  storedName: string;
  sizeBytes: number;
  mime: string;
  extension: string;
  absolutePath: string;
}

export async function storeUpload(file: File): Promise<StoredUpload> {
  const originalName = safeFilename(file.name || "upload");
  const extension = extensionOf(originalName);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new UploadError(
      `Files of type ".${extension || "(none)"}" are not accepted. Allowed: ${[...ALLOWED_EXTENSIONS].sort().join(", ")}.`,
      415,
    );
  }
  const limit = maxUploadBytes();
  if (file.size > limit) {
    throw new UploadError(`File is ${(file.size / 1e6).toFixed(1)} MB, above the ${(limit / 1e6).toFixed(0)} MB limit.`, 413);
  }
  if (file.size === 0) throw new UploadError("The file is empty.", 400);

  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${crypto.randomBytes(8).toString("hex")}-${originalName}`;
  const absolutePath = resolveStoredPath(storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  // Double-check the realised size, since File.size is client-reported.
  if (buffer.byteLength > limit) {
    throw new UploadError(`File body is larger than the ${(limit / 1e6).toFixed(0)} MB limit.`, 413);
  }
  await fs.writeFile(absolutePath, buffer);

  return {
    originalName,
    storedName,
    sizeBytes: buffer.byteLength,
    mime: mimeFor(originalName),
    extension,
    absolutePath,
  };
}

export async function readStored(storedName: string): Promise<Buffer> {
  return fs.readFile(resolveStoredPath(storedName));
}
