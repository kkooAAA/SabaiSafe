// Fixed-window in-memory rate limiter. Per server instance only (good enough for the MVP on Vercel;
// a shared store such as Upstash would be needed for a strict global limit — that is a paid-service decision).
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()) {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  b.count += 1;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

/** True if the key is already over its limit. Does not count a request. */
export function isLimited(key: string, limit: number, now = Date.now()) {
  const b = buckets.get(key);
  return !!b && b.resetAt > now && b.count >= limit;
}

export function resetRateLimits() {
  buckets.clear();
}

/** Routes that call an LLM get the stricter limit. */
export function isAiRoute(pathname: string) {
  return pathname.startsWith("/api/chat") || pathname.startsWith("/api/report");
}
