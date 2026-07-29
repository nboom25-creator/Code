import { exportProject, getProject } from "@/lib/db/repo";
import { fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = getProject(id);
    if (!project) return fail("Project not found.", 404);
    const bundle = exportProject(id);
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${project.slug}-backup.json"`,
      },
    });
  } catch (e) {
    return handleError(e, "GET export");
  }
}
