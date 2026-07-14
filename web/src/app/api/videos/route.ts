import { NextResponse } from "next/server";
import { searchVideos, type VideoFilters } from "@/lib/youtube";
import { checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

/**
 * Video search. Accepts AI-generated queries (from a lesson/problem) plus UI
 * filters. Returns a typed outcome so the client can distinguish real results
 * from "no key / quota / empty" states — we NEVER fabricate videos.
 */
export async function POST(req: Request) {
  const limited = checkRate(req, "videos");
  if (limited) return limited;
  try {
    const body = await req.json();
    const queries: string[] = Array.isArray(body.queries)
      ? body.queries.map((q: unknown) => String(q))
      : [];
    const filters: VideoFilters = {
      duration: body.filters?.duration,
      level: body.filters?.level,
      intent: body.filters?.intent,
      captionsOnly: !!body.filters?.captionsOnly,
    };
    const outcome = await searchVideos(queries, filters, { nowMs: Date.now(), perQuery: 6 });
    return NextResponse.json(outcome);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Video search failed";
    return NextResponse.json({ status: "error", queries: [], message: msg }, { status: 500 });
  }
}
