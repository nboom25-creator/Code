import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Reports integration configuration WITHOUT leaking secrets — only booleans.
 * The UI uses this to show honest "configure X" banners instead of pretending
 * a missing integration works.
 */
export async function GET() {
  let calcOk = false;
  const calcUrl = process.env.CALC_SERVICE_URL;
  if (calcUrl) {
    try {
      const res = await fetch(`${calcUrl.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      calcOk = res.ok;
    } catch {
      calcOk = false;
    }
  }
  return NextResponse.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    youtube: !!process.env.YOUTUBE_API_KEY,
    calcService: calcOk,
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  });
}
