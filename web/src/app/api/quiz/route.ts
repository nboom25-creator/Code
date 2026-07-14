import { NextResponse } from "next/server";
import { structuredCall } from "@/lib/anthropic";
import { QuizSchema } from "@/lib/schemas";
import { QUIZ_TOOL } from "@/lib/toolSchemas";
import { quizSystem, quizUser, DEFAULT_CONTROLS, type Controls } from "@/lib/prompts";
import { errorResponse, checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = checkRate(req, "quiz");
  if (limited) return limited;
  try {
    const body = await req.json();
    const subject: string = (body.subject || "").toString().slice(0, 500);
    if (!subject.trim()) {
      return NextResponse.json({ error: "Please choose a subject.", code: "bad_input" }, { status: 400 });
    }
    const count = Math.min(Math.max(parseInt(body.count) || 5, 1), 15);
    const controls: Controls = { ...DEFAULT_CONTROLS, ...(body.controls || {}) };
    const quiz = await structuredCall({
      system: quizSystem(),
      user: quizUser(
        {
          subject,
          topic: (body.topic || "").toString().slice(0, 500),
          difficulty: body.difficulty || controls.level,
          count,
          types: Array.isArray(body.types) ? body.types : [],
          minutes: body.minutes ? parseInt(body.minutes) : undefined,
        },
        controls,
      ),
      tool: QUIZ_TOOL,
      schema: QuizSchema,
      maxTokens: 5000,
    });
    return NextResponse.json({ quiz });
  } catch (err) {
    return errorResponse(err);
  }
}
