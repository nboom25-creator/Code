"use client";

/**
 * Thin fetch wrapper used by every editable page.
 *
 * Errors surface the server's message rather than a generic failure, because
 * the server-side validation messages are the useful ones (unit problems,
 * physical range violations, immutability refusals).
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init?.headers : { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON bodies (file downloads) are handled by the caller */
  }
  if (!res.ok) {
    const body = json as { error?: string; detail?: string; issues?: { path: string; message: string }[] } | null;
    throw new ApiError(body?.error ?? `Request failed (HTTP ${res.status}).`, res.status, body?.issues);
  }
  return json as T;
}

export type Row = Record<string, unknown>;

export const api = {
  list: (projectId: string, table: string) => request<{ rows: Row[] }>(`/api/projects/${projectId}/${table}`),
  create: (projectId: string, table: string, data: Row) =>
    request<{ row: Row }>(`/api/projects/${projectId}/${table}`, { method: "POST", body: JSON.stringify(data) }),
  update: (projectId: string, table: string, rowId: string, data: Row) =>
    request<{ row: Row }>(`/api/projects/${projectId}/${table}/${rowId}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (projectId: string, table: string, rowId: string) =>
    request<{ deleted: boolean }>(`/api/projects/${projectId}/${table}/${rowId}`, { method: "DELETE" }),
  saveSettings: (projectId: string, settings: unknown) =>
    request<{ settings: unknown }>(`/api/projects/${projectId}/settings`, { method: "PUT", body: JSON.stringify(settings) }),
  undo: (projectId: string) => request<{ undone: boolean; description: string }>(`/api/projects/${projectId}/undo`, { method: "POST" }),
  simulate: (projectId: string, body: Row) =>
    request<{ input: Row; result: unknown }>(`/api/projects/${projectId}/simulate`, { method: "POST", body: JSON.stringify(body) }),
  ask: (projectId: string, question: string) =>
    request<{ answer: unknown }>(`/api/projects/${projectId}/assistant`, { method: "POST", body: JSON.stringify({ question }) }),
  upload: (projectId: string, form: FormData) =>
    request<{ kind: string; row: Row; parse?: unknown }>(`/api/projects/${projectId}/upload`, { method: "POST", body: form }),
  createProject: (data: Row) => request<{ project: Row }>(`/api/projects`, { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: Row) => request<{ project: Row }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  createSample: () => request<{ project: Row }>(`/api/sample`, { method: "POST" }),
};

/** Trigger a browser download of text content. */
export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Serialise an array of records to CSV, quoting where required. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/** Parse a CSV string into headers and rows. Handles quoted fields. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return { headers: headers.map((h) => h.trim()), rows };
}

export function jsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
