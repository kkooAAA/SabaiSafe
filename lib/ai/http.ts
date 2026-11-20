// JSON helpers shared by the ai-owned route handlers (contracts §3: error shape and status codes).
import type { ApiError } from "@/types/api";
import type { z } from "zod";
import { AiUnavailableError } from "./provider";

export function jsonError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
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
  console.error("[ai route]", err);
  return jsonError(500, "internal", "Something went wrong. Please try again.");
}
