import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema.generated";

/**
 * SQLite persistence.
 *
 * DEVIATION FROM THE SUGGESTED STACK, recorded deliberately: the brief
 * suggested PostgreSQL + Prisma with a SQLite fallback. This application uses
 * SQLite directly through better-sqlite3 with hand-written SQL migrations
 * because:
 *   - a senior-design workspace is single-user and file-based; a whole
 *     database server is friction for the user who has to run this,
 *   - better-sqlite3 is synchronous, which suits Next.js route handlers doing
 *     small reads, and needs no query engine binary download,
 *   - the schema is plain SQL, so it is reviewable by anyone.
 * Moving to Postgres later means swapping this file and the SQL dialect; the
 * repository layer above it is already isolated.
 */

const SCHEMA_VERSION = "1";

let db: Database.Database | null = null;

function resolveDbPath(): string {
  const configured = process.env.GLIDERFORGE_DB ?? "./data/gliderforge.db";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function getDb(): Database.Database {
  if (db) return db;
  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(conn: Database.Database) {
  // The schema is bundled as a generated TypeScript module (see
  // scripts/gen-schema.mjs) so migration never depends on the source tree
  // being present at runtime. Every statement is CREATE ... IF NOT EXISTS, so
  // running it on an existing database is a no-op.
  conn.exec(SCHEMA_SQL);
  conn
    .prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(SCHEMA_VERSION);
}

/** Close the connection (used by scripts and tests). */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

let idCounter = 0;
/** Collision-resistant, sortable, human-inspectable id. */
export function newId(prefix = "id"): string {
  idCounter = (idCounter + 1) % 0xffff;
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}_${time}${idCounter.toString(36)}${rand}`;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}
