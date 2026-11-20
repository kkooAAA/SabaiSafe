// Error responses in the contract shape (§3): { error: { code, message, fields? } }. Owner: backend.
// Never put a key, a stack or raw Postgres/PostgREST text in a response: details go to the server log only.
import type { ApiError } from "@/types/api";
import { ConflictError, DbUnavailableError, ValidationError } from "./errors";

export function errorResponse(
  status: number,
  code: string,
  message: string,
  opts: { fields?: Record<string, string>; headers?: HeadersInit } = {},
): Response {
  const body: ApiError = { error: { code, message, ...(opts.fields ? { fields: opts.fields } : {}) } };
  return Response.json(body, { status, headers: opts.headers });
}

/**
 * Maps lib/db errors: ValidationError → 400 (with fields), ConflictError → 409, DbUnavailableError → 503,
 * anything else → 500.
 */
export function dbErrorResponse(err: unknown, headers?: HeadersInit): Response {
  if (err instanceof ValidationError) return errorResponse(400, "bad_request", err.message, { fields: err.fields, headers });
  if (err instanceof ConflictError) return errorResponse(409, "conflict", err.message, { headers });
  if (err instanceof DbUnavailableError) return errorResponse(503, "unavailable", "Data service unavailable.", { headers });
  console.error(err);
  return errorResponse(500, "internal", "Something went wrong.", { headers });
}
