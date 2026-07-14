"use client";

/**
 * Guest-mode persistence via localStorage. No account required — this satisfies
 * the "save a lesson/problem" and "resume a recent session" MVP criteria with
 * zero backend setup. Everything here is user-controllable and deletable.
 *
 * The optional Prisma/SQLite backend (see prisma/schema.prisma) is the upgrade
 * path for synced accounts; the same shapes serialize to the Session.payload
 * column.
 */

import type { Controls } from "./prompts";

const PREFIX = "engtutor:";
const SESSIONS_KEY = PREFIX + "sessions";
const PREFS_KEY = PREFIX + "prefs";
const MASTERY_KEY = PREFIX + "mastery";

export type SessionKind = "lesson" | "problem" | "quiz" | "study-plan";

export interface SavedSession {
  id: string;
  kind: SessionKind;
  title: string;
  topic: string;
  payload: unknown;
  createdAt: number;
  updatedAt: number;
}

export type MasteryStatus =
  | "not-started"
  | "learning"
  | "practicing"
  | "proficient"
  | "review-recommended";

export interface TopicMastery {
  topic: string;
  status: MasteryStatus;
  attempts: number;
  correct: number;
  updatedAt: number;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}

// A stable-ish id without Date.now-in-pure-code concerns (this runs client-side).
function id(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- Sessions --------------------------------------------------------------

export function listSessions(): SavedSession[] {
  return read<SavedSession[]>(SESSIONS_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveSession(
  input: Omit<SavedSession, "id" | "createdAt" | "updatedAt"> & { id?: string },
): SavedSession {
  const all = read<SavedSession[]>(SESSIONS_KEY, []);
  const now = Date.now();
  const existingIdx = input.id ? all.findIndex((s) => s.id === input.id) : -1;
  if (existingIdx >= 0) {
    const updated = { ...all[existingIdx], ...input, updatedAt: now } as SavedSession;
    all[existingIdx] = updated;
    write(SESSIONS_KEY, all);
    return updated;
  }
  const created: SavedSession = {
    id: input.id || id(),
    kind: input.kind,
    title: input.title,
    topic: input.topic,
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  };
  all.push(created);
  write(SESSIONS_KEY, all);
  return created;
}

export function getSession(sid: string): SavedSession | undefined {
  return read<SavedSession[]>(SESSIONS_KEY, []).find((s) => s.id === sid);
}

export function deleteSession(sid: string) {
  write(SESSIONS_KEY, read<SavedSession[]>(SESSIONS_KEY, []).filter((s) => s.id !== sid));
}

export function clearAllSessions() {
  write(SESSIONS_KEY, []);
}

// --- Preferences -----------------------------------------------------------

export interface Prefs extends Controls {
  discipline: string;
  theme: "light" | "dark" | "system";
}

export const DEFAULT_PREFS: Prefs = {
  level: "intermediate",
  detail: "detailed",
  units: "SI",
  rigor: "standard",
  includeDerivations: true,
  discipline: "",
  theme: "system",
};

export function getPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...read<Partial<Prefs>>(PREFS_KEY, {}) };
}
export function setPrefs(p: Partial<Prefs>) {
  write(PREFS_KEY, { ...getPrefs(), ...p });
}

// --- Mastery ---------------------------------------------------------------

export function getMastery(): TopicMastery[] {
  return read<TopicMastery[]>(MASTERY_KEY, []);
}

export function recordAttempt(topic: string, correct: boolean) {
  const all = read<TopicMastery[]>(MASTERY_KEY, []);
  let m = all.find((x) => x.topic.toLowerCase() === topic.toLowerCase());
  if (!m) {
    m = { topic, status: "learning", attempts: 0, correct: 0, updatedAt: Date.now() };
    all.push(m);
  }
  m.attempts++;
  if (correct) m.correct++;
  m.updatedAt = Date.now();
  m.status = deriveStatus(m);
  write(MASTERY_KEY, all);
}

function deriveStatus(m: TopicMastery): MasteryStatus {
  if (m.attempts === 0) return "not-started";
  const ratio = m.correct / m.attempts;
  if (m.attempts >= 5 && ratio >= 0.8) return "proficient";
  if (m.attempts >= 3 && ratio < 0.5) return "review-recommended";
  if (m.attempts >= 2) return "practicing";
  return "learning";
}

export function clearMastery() {
  write(MASTERY_KEY, []);
}

/** Delete ALL EngineerTutor data (privacy control). */
export function deleteEverything() {
  if (typeof window === "undefined") return;
  [SESSIONS_KEY, PREFS_KEY, MASTERY_KEY].forEach((k) => window.localStorage.removeItem(k));
}
