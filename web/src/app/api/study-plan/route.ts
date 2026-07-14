import { NextResponse } from "next/server";
import { structuredCall } from "@/lib/anthropic";
import { StudyPlanSchema } from "@/lib/schemas";
import { STUDY_PLAN_TOOL } from "@/lib/toolSchemas";
import { studyPlanSystem, studyPlanUser, DEFAULT_CONTROLS, type Controls } from "@/lib/prompts";
import { errorResponse, checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = checkRate(req, "study-plan");
  if (limited) return limited;
  try {
    const body = await req.json();
    const course: string = (body.course || "").toString().slice(0, 500);
    if (!course.trim()) {
      return NextResponse.json({ error: "Please enter a course.", code: "bad_input" }, { status: 400 });
    }
    const controls: Controls = { ...DEFAULT_CONTROLS, ...(body.controls || {}) };
    const plan = await structuredCall({
      system: studyPlanSystem(),
      user: studyPlanUser(
        {
          course,
          topics: (body.topics || "").toString().slice(0, 2000),
          examDate: (body.examDate || "").toString().slice(0, 100),
          hoursPerDay: Number(body.hoursPerDay) || 2,
          confidence: (body.confidence || "").toString().slice(0, 2000),
          learningStyle: (body.learningStyle || "").toString().slice(0, 200),
        },
        controls,
      ),
      tool: STUDY_PLAN_TOOL,
      schema: StudyPlanSchema,
      maxTokens: 5000,
    });
    return NextResponse.json({ plan });
  } catch (err) {
    return errorResponse(err);
  }
}
