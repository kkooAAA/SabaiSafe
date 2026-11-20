// Helpers for the /api/admin/* route handlers. Owner: backend. Contracts §3.9 (v0.6).
// Not a route (only route.ts files are). Auth and rate limiting are in middleware.ts.
import { revalidatePath } from "next/cache";
import { isSampleMode } from "@/lib/db/client";
import { dbErrorResponse, errorResponse } from "@/lib/db/http";

const MAX_BODY_CHARS = 32_000;

/**
 * Every admin response: never cached anywhere, and says whether the write is persisted (sample mode: false).
 * Reads only env (cannot throw), so the error path always produces a clean response.
 */
export function adminHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Admin-Persisted": String(!isSampleMode()) };
}

export function adminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: adminHeaders() });
}

export function adminNoContent(): Response {
  return new Response(null, { status: 204, headers: adminHeaders() });
}

export function adminNotFound(): Response {
  return errorResponse(404, "not_found", "No such row.", { headers: adminHeaders() });
}

export function adminError(err: unknown): Response {
  return dbErrorResponse(err, adminHeaders());
}

/** Parsed JSON body, or a 400 Response. The shape is validated later by lib/db/admin.ts. */
export async function readJson(req: Request): Promise<{ body: unknown } | Response> {
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) {
    return errorResponse(400, "bad_request", "Body too large.", { fields: { body: "too large" }, headers: adminHeaders() });
  }
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return errorResponse(400, "bad_request", "Body must be JSON.", { fields: { body: "invalid JSON" }, headers: adminHeaders() });
  }
}

/**
 * After a write: refresh the ISR pages that read prices/help (revalidate = 300). The in-process caches are
 * already cleared by lib/db/admin.ts. Outside a Next request (Vitest) revalidatePath throws; that's harmless.
 */
export function revalidatePublicPages(): void {
  for (const p of ["/[locale]/price", "/[locale]/help"]) {
    try {
      revalidatePath(p, "page");
    } catch {
      // no Next context
    }
  }
}
