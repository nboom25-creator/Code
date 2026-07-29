import { createSampleProject } from "@/lib/sample/sampleProject";
import { ok, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const project = createSampleProject();
    return ok({ project }, 201);
  } catch (e) {
    return handleError(e, "POST /api/sample");
  }
}
