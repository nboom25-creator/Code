import { z } from "zod";
import { createProject, listProjects, createRow } from "@/lib/db/repo";
import { projectSettingsSchema } from "@/lib/project/settings";
import { slugify } from "@/lib/db/client";
import { STARTER_RISKS } from "@/lib/sample/starterRisks";
import { ok, handleError, readJson, sanitizeText } from "@/lib/api";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  phase: z.string().max(40).optional(),
  includeStarterRisks: z.boolean().optional().default(true),
  settings: z.unknown().optional(),
});

export async function GET() {
  try {
    return ok({ projects: listProjects() });
  } catch (e) {
    return handleError(e, "GET /api/projects");
  }
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await readJson(req));
    const base = slugify(body.name);
    const taken = new Set(listProjects().map((p) => p.slug));
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;

    const settings = projectSettingsSchema.parse(body.settings ?? {});
    const project = createProject({
      name: sanitizeText(body.name)!,
      slug,
      description: sanitizeText(body.description),
      phase: body.phase ?? "concept",
      settings,
    });

    // A new project starts with the starter risk register so the team has
    // something to review rather than a blank page. Every entry is flagged
    // is_starter with reviewed = 0 until the team edits it.
    if (body.includeStarterRisks) {
      for (const r of STARTER_RISKS) createRow("risks", project.id, { ...r, is_starter: 1, reviewed: 0 });
    }
    return ok({ project }, 201);
  } catch (e) {
    return handleError(e, "POST /api/projects");
  }
}
