import { NextResponse } from "next/server";
import { z } from "zod";
import { RepoError } from "@/lib/db/repo";

/**
 * Shared API helpers.
 *
 * Every route validates input server-side, returns a stable error shape, and
 * logs failures without echoing secrets or full request bodies.
 */

export interface ApiError {
  error: string;
  detail?: string;
  issues?: { path: string; message: string }[];
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, detail?: string) {
  return NextResponse.json<ApiError>({ error: message, detail }, { status });
}

/** Convert any thrown value into a safe response. */
export function handleError(e: unknown, context: string) {
  if (e instanceof RepoError) return fail(e.message, e.status);
  if (e instanceof z.ZodError) {
    return NextResponse.json<ApiError>(
      {
        error: "The submitted data failed validation.",
        issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 422 },
    );
  }
  const message = e instanceof Error ? e.message : String(e);
  // Log the context and message only — never the request body, headers or env.
  console.error(`[gliderforge] ${context}: ${message}`);
  return fail("The server could not complete the request.", 500, message.slice(0, 300));
}

/** Parse a JSON body with a size guard. */
export async function readJson(req: Request, maxBytes = 5_000_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new RepoError(`Request body exceeds the ${(maxBytes / 1e6).toFixed(0)} MB limit.`, 413);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RepoError("Request body is not valid JSON.", 400);
  }
}

/**
 * Strip control characters and cap the length of free text so a pasted blob
 * cannot break rendering or bloat the database.
 */
export function sanitizeText(value: unknown, maxLength = 20000): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value)
    // Control characters, keeping tab, line feed and carriage return.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maxLength);
  return s;
}

/** Sanitize every string in a flat payload object. */
export function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string") out[k] = sanitizeText(v);
    else out[k] = v;
  }
  return out;
}

/**
 * Make a user-supplied filename safe to store on disk.
 * Strips directory separators, traversal sequences and control characters.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 120);
  return cleaned || "file";
}
