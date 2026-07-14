import { NextResponse } from "next/server";
import { structuredCall } from "@/lib/anthropic";
import { TutorReplySchema } from "@/lib/schemas";
import { TUTOR_TOOL } from "@/lib/toolSchemas";
import { tutorSystem, tutorUser, DEFAULT_CONTROLS, type Controls } from "@/lib/prompts";
import { errorResponse, checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

/** Follow-up Q&A that stays within the active lesson/problem context. */
export async function POST(req: Request) {
  const limited = checkRate(req, "tutor");
  if (limited) return limited;
  try {
    const body = await req.json();
    const question: string = (body.question || "").toString().slice(0, 3000);
    if (!question.trim()) {
      return NextResponse.json({ error: "Please enter a question.", code: "bad_input" }, { status: 400 });
    }
    const context = JSON.stringify(body.context ?? {}).slice(0, 12000);
    const controls: Controls = { ...DEFAULT_CONTROLS, ...(body.controls || {}) };
    const reply = await structuredCall({
      system: tutorSystem(),
      user: tutorUser(question, context, controls),
      tool: TUTOR_TOOL,
      schema: TutorReplySchema,
      maxTokens: 2500,
    });
    return NextResponse.json({ reply });
  } catch (err) {
    return errorResponse(err);
  }
}
