import { cookies } from "next/headers";
import { getProject, listProjects, type ProjectRow } from "@/lib/db/repo";
import { buildSnapshot, type ProjectSnapshot } from "./snapshot";

export const ACTIVE_PROJECT_COOKIE = "gf_project";

/**
 * The "current project" is stored in a cookie so every module page can be a
 * plain top-level route (/components, /mass, …) rather than carrying the
 * project id through the URL. If the cookie is missing or stale, the most
 * recently updated project is used.
 */
export async function getActiveProject(): Promise<ProjectRow | null> {
  const store = await cookies();
  const id = store.get(ACTIVE_PROJECT_COOKIE)?.value;
  if (id) {
    const p = getProject(id);
    if (p) return p;
  }
  const all = listProjects();
  return all[0] ?? null;
}

export async function getActiveSnapshot(): Promise<ProjectSnapshot | null> {
  const project = await getActiveProject();
  return project ? buildSnapshot(project) : null;
}
