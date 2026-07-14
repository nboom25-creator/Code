/**
 * Minimal in-memory per-IP rate limiter. Good enough for a single-instance
 * deployment / local dev; swap for Redis in a multi-instance production setup.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(ip: string, routeKey: string): { ok: boolean; retryAfter: number } {
  const limit = parseInt(process.env.RATE_LIMIT_PER_MINUTE || "30", 10);
  const key = `${routeKey}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true, retryAfter: 0 };
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}
