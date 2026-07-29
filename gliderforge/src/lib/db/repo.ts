import { getDb, newId, nowIso } from "./client";

/**
 * Generic repository.
 *
 * Column names are read from the database itself (PRAGMA table_info), so an
 * incoming payload can never introduce an unexpected column, and every value
 * is bound as a parameter rather than interpolated. Table names are checked
 * against an allow-list.
 *
 * Every create/update/delete is written to `revisions` with a before/after
 * snapshot, which is what powers undo.
 */

export const PROJECT_TABLES = [
  "requirements",
  "components",
  "material_overrides",
  "geometry_files",
  "attachments",
  "syringe_configs",
  "buoyancy_states",
  "electronics",
  "pin_assignments",
  "calculation_runs",
  "simulations",
  "assumptions",
  "decisions",
  "risks",
  "tests",
  "test_runs",
  "notebook_entries",
  "refs",
  "tasks",
  "milestones",
  "reports",
  "ai_recommendations",
  "design_variants",
  "assistant_messages",
] as const;

export type ProjectTable = (typeof PROJECT_TABLES)[number];

/** Tables whose rows are immutable snapshots — updates are refused. */
const IMMUTABLE_TABLES = new Set<string>(["calculation_runs"]);

const ID_PREFIX: Record<string, string> = {
  requirements: "req",
  components: "cmp",
  geometry_files: "geo",
  attachments: "att",
  syringe_configs: "syr",
  buoyancy_states: "bst",
  electronics: "elec",
  pin_assignments: "pin",
  calculation_runs: "calc",
  simulations: "sim",
  assumptions: "asm",
  decisions: "dec",
  risks: "risk",
  tests: "test",
  test_runs: "run",
  notebook_entries: "note",
  refs: "ref",
  tasks: "task",
  milestones: "ms",
  reports: "rep",
  ai_recommendations: "rec",
  design_variants: "var",
  assistant_messages: "msg",
  material_overrides: "mat",
};

export class RepoError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

function assertTable(table: string): asserts table is ProjectTable {
  if (!(PROJECT_TABLES as readonly string[]).includes(table)) {
    throw new RepoError(`Unknown collection "${table}".`, 404);
  }
}

const columnCache = new Map<string, Set<string>>();

function columnsOf(table: string): Set<string> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  const set = new Set(rows.map((r) => r.name));
  columnCache.set(table, set);
  return set;
}

export type Row = Record<string, unknown>;

function sanitize(table: string, data: Row): Row {
  const cols = columnsOf(table);
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (!cols.has(k)) continue;
    if (k === "id" || k === "created_at") continue;
    if (v === undefined) continue;
    if (typeof v === "boolean") out[k] = v ? 1 : 0;
    else if (v !== null && typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = v as string | number | null;
  }
  return out;
}

function logRevision(
  projectId: string,
  table: string,
  entityId: string,
  action: "create" | "update" | "delete",
  before: Row | null,
  after: Row | null,
) {
  getDb()
    .prepare(
      `INSERT INTO revisions (project_id, entity_type, entity_id, action, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      table,
      entityId,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      nowIso(),
    );
}

export function listRows(table: string, projectId: string, orderBy = "created_at DESC"): Row[] {
  assertTable(table);
  const cols = columnsOf(table);
  const order = cols.has(orderBy.split(" ")[0]) ? orderBy : "rowid";
  return getDb()
    .prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY ${order}`)
    .all(projectId) as Row[];
}

export function getRow(table: string, id: string): Row | undefined {
  assertTable(table);
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
}

export function createRow(table: string, projectId: string, data: Row): Row {
  assertTable(table);
  const clean = sanitize(table, data);
  const cols = columnsOf(table);
  const id = typeof data.id === "string" && data.id ? data.id : newId(ID_PREFIX[table] ?? "row");
  const record: Row = { id, project_id: projectId, ...clean };
  if (cols.has("created_at")) record.created_at = nowIso();
  if (cols.has("updated_at")) record.updated_at = nowIso();

  const keys = Object.keys(record);
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
  getDb()
    .prepare(sql)
    .run(...keys.map((k) => record[k] as never));
  const created = getRow(table, id)!;
  logRevision(projectId, table, id, "create", null, created);
  touchProject(projectId);
  return created;
}

export function updateRow(table: string, id: string, data: Row): Row {
  assertTable(table);
  if (IMMUTABLE_TABLES.has(table)) {
    throw new RepoError(
      `${table} rows are immutable snapshots so that past results stay reproducible. Create a new run instead of editing this one.`,
      409,
    );
  }
  const before = getRow(table, id);
  if (!before) throw new RepoError(`No ${table} record with id ${id}.`, 404);
  const clean = sanitize(table, data);
  if (columnsOf(table).has("updated_at")) clean.updated_at = nowIso();
  const keys = Object.keys(clean);
  if (keys.length === 0) return before;
  getDb()
    .prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => clean[k] as never), id);
  const after = getRow(table, id)!;
  logRevision(before.project_id as string, table, id, "update", before, after);
  touchProject(before.project_id as string);
  return after;
}

export function deleteRow(table: string, id: string): void {
  assertTable(table);
  const before = getRow(table, id);
  if (!before) throw new RepoError(`No ${table} record with id ${id}.`, 404);
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  logRevision(before.project_id as string, table, id, "delete", before, null);
  touchProject(before.project_id as string);
}

function touchProject(projectId: string) {
  getDb().prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(nowIso(), projectId);
}

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

export interface RevisionRow {
  id: number;
  project_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  undone: number;
  created_at: string;
}

export function recentRevisions(projectId: string, limit = 20): RevisionRow[] {
  return getDb()
    .prepare(`SELECT * FROM revisions WHERE project_id = ? ORDER BY id DESC LIMIT ?`)
    .all(projectId, limit) as RevisionRow[];
}

/**
 * Undo the most recent not-yet-undone change in a project.
 *
 * create -> delete the row; delete -> reinsert it; update -> restore the
 * previous column values. The undo itself is marked rather than logged as a
 * new change, so pressing undo repeatedly walks backwards through history.
 */
export function undoLast(projectId: string): { undone: boolean; description: string } {
  const db = getDb();
  const rev = db
    .prepare(`SELECT * FROM revisions WHERE project_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1`)
    .get(projectId) as RevisionRow | undefined;
  if (!rev) return { undone: false, description: "Nothing left to undo in this project." };

  const table = rev.entity_type;
  if (!(PROJECT_TABLES as readonly string[]).includes(table)) {
    return { undone: false, description: `Cannot undo a change to "${table}".` };
  }

  const before = rev.before_json ? (JSON.parse(rev.before_json) as Row) : null;
  const apply = db.transaction(() => {
    if (rev.action === "create") {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(rev.entity_id);
    } else if (rev.action === "delete" && before) {
      const keys = Object.keys(before);
      db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(
        ...keys.map((k) => before[k] as never),
      );
    } else if (rev.action === "update" && before) {
      const keys = Object.keys(before).filter((k) => k !== "id");
      db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
        ...keys.map((k) => before[k] as never),
        rev.entity_id,
      );
    }
    db.prepare(`UPDATE revisions SET undone = 1 WHERE id = ?`).run(rev.id);
  });
  apply();
  touchProject(projectId);
  const label = (before?.name ?? before?.title ?? rev.entity_id) as string;
  return { undone: true, description: `Undid ${rev.action} of ${table.replace(/_/g, " ")} "${label}".` };
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string | null;
  phase: string;
  is_sample: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export function listProjects(): ProjectRow[] {
  return getDb().prepare(`SELECT * FROM projects ORDER BY updated_at DESC`).all() as ProjectRow[];
}

export function getProject(id: string): ProjectRow | undefined {
  return getDb().prepare(`SELECT * FROM projects WHERE id = ? OR slug = ?`).get(id, id) as ProjectRow | undefined;
}

export function createProject(data: {
  name: string;
  slug: string;
  description?: string;
  phase?: string;
  isSample?: boolean;
  settings?: unknown;
}): ProjectRow {
  const id = newId("proj");
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, slug, description, phase, is_sample, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name,
      data.slug,
      data.description ?? null,
      data.phase ?? "concept",
      data.isSample ? 1 : 0,
      JSON.stringify(data.settings ?? {}),
      ts,
      ts,
    );
  return getProject(id)!;
}

export function updateProject(id: string, data: Partial<{ name: string; description: string; phase: string; settings_json: string }>): ProjectRow {
  const keys = Object.entries(data).filter(([, v]) => v !== undefined);
  if (keys.length > 0) {
    getDb()
      .prepare(`UPDATE projects SET ${keys.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map(([, v]) => v as never), nowIso(), id);
  }
  return getProject(id)!;
}

export function deleteProject(id: string): void {
  getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  getDb().prepare(`DELETE FROM revisions WHERE project_id = ?`).run(id);
}

/** Everything belonging to a project, for export/backup and the assistant. */
export function exportProject(id: string): Record<string, unknown> {
  const project = getProject(id);
  if (!project) throw new RepoError("Project not found.", 404);
  const bundle: Record<string, unknown> = {
    exportedAt: nowIso(),
    schemaVersion: 1,
    project: { ...project, settings: JSON.parse(project.settings_json || "{}") },
  };
  for (const table of PROJECT_TABLES) {
    bundle[table] = listRows(table, project.id, "created_at ASC");
  }
  return bundle;
}
