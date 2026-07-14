import { NextResponse } from "next/server";
import { structuredCall } from "@/lib/anthropic";
import { LessonSchema } from "@/lib/schemas";
import { LESSON_TOOL } from "@/lib/toolSchemas";
import { lessonSystem, lessonUser, DEFAULT_CONTROLS, type Controls } from "@/lib/prompts";
import { errorResponse, checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = checkRate(req, "lesson");
  if (limited) return limited;
  try {
    const body = await req.json();
    const topic: string = (body.topic || "").toString().slice(0, 2000);
    if (!topic.trim()) {
      return NextResponse.json({ error: "Please enter a topic.", code: "bad_input" }, { status: 400 });
    }
    const controls: Controls = { ...DEFAULT_CONTROLS, ...(body.controls || {}) };
    const lesson = await structuredCall({
      system: lessonSystem(),
      user: lessonUser(topic, controls),
      tool: LESSON_TOOL,
      schema: LessonSchema,
      maxTokens: 4500,
    });
    return NextResponse.json({ lesson });
  } catch (err) {
    return errorResponse(err);
  }
}
