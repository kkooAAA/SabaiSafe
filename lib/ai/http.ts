// JSON helpers shared by the ai-owned route handlers (contracts §3: error shape and status codes).
import type { ApiError } from "@/types/api";
import type { z } from "zod";
import { isBusyError, isDailyQuotaError, retryDelayMs } from "./fallback";
import { AiUnavailableError } from "./provider";

export function jsonError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Retry-After (whole seconds, 1..60) for a busy upstream error that says how long to wait. None for a daily quota
 * (waiting a minute won't help) or when the upstream gave no delay.
 */
export function retryAfterHeader(err: unknown): Record<string, string> {
  const ms = isDailyQuotaError(err) ? null : retryDelayMs(err);
  return ms === null ? {} : { "Retry-After": String(Math.min(60, Math.max(1, Math.ceil(ms / 1000)))) };
}

/** Parses and validates a JSON body. Returns the data, or a 400 Response. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, "bad_request", "Body must be valid JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, response: jsonError(400, "bad_request", `${where}${first?.message ?? "Invalid request."}`) };
  }
  return { ok: true, data: parsed.data };
}

/** Maps errors thrown before streaming started to the contract's error responses. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AiUnavailableError || (err instanceof Error && err.name === "DbUnavailableError")) {
    return jsonError(503, "unavailable", "This service is temporarily unavailable.");
  }
  // Upstream model rate limit / quota / overload (429 or 5xx), after the fallback model also failed.
  if (isBusyError(err)) {
    console.warn("[ai route] upstream model busy:", err instanceof Error ? err.message.slice(0, 200) : String(err));
    return jsonError(503, "unavailable", "The AI service is busy. Please try again in a minute.", retryAfterHeader(err));
  }
  console.error("[ai route]", err);
  return jsonError(500, "internal", "Something went wrong. Please try again.");
}
