// Error responses in the contract shape (§3): { error: { code, message } }. Owner: backend.
import type { ApiError } from "@/types/api";
import { DbUnavailableError } from "./errors";

export function errorResponse(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

/** Maps lib/db errors: DbUnavailableError → 503, anything else → 500 (details go to the server log only). */
export function dbErrorResponse(err: unknown): Response {
  if (err instanceof DbUnavailableError) return errorResponse(503, "unavailable", "Data service unavailable.");
  console.error(err);
  return errorResponse(500, "internal", "Something went wrong.");
}
