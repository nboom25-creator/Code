import { NextResponse } from "next/server";
import { ConfigError, AIError, ValidationError } from "./anthropic";
import { rateLimit, clientIp } from "./rateLimit";

/** Map thrown errors to friendly JSON responses. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ConfigError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  }
  if (err instanceof AIError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 502 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 502 });
  }
  const msg = err instanceof Error ? err.message : "Unexpected server error";
  return NextResponse.json({ error: msg, code: "internal" }, { status: 500 });
}

/** Enforce rate limiting; returns a 429 response if exceeded, else null. */
export function checkRate(req: Request, routeKey: string): NextResponse | null {
  const { ok, retryAfter } = rateLimit(clientIp(req), routeKey);
  if (!ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Try again in ${retryAfter}s.`, code: "rate_limited" },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }
  return null;
}
