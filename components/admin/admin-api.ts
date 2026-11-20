// Fetch wrappers for /api/admin/* (contracts §3.9). Same-origin, so the browser sends the HTTP Basic credentials.
import type { ApiError } from "@/types/api";
import { apiFieldErrors, type Body, type Entity, type FieldErrors, type Row } from "./admin-form";

export type AdminFail = { ok: false; status: number; code: string; message: string; fields: FieldErrors };
export type AdminResult<T> = ({ ok: true; persisted: boolean } & T) | AdminFail;

async function fail(res: Response | null): Promise<AdminFail> {
  if (!res) return { ok: false, status: 0, code: "network", message: "", fields: {} };
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON */
  }
  const e = (body as ApiError | null)?.error;
  return { ok: false, status: res.status, code: e?.code ?? "internal", message: e?.message ?? "", fields: apiFieldErrors(body) };
}

async function request(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  } catch {
    return null;
  }
}

/**
 * `persisted: false` = sample mode (in-memory, lost on restart). Every admin response, including 204, has the
 * header X-Admin-Persisted; the body flag is the fallback. Missing both = persisted.
 */
function persistedOf(res: Response, v: unknown): boolean {
  const h = res.headers.get("X-Admin-Persisted");
  if (h === "false") return false;
  if (h === "true") return true;
  return !(v && typeof v === "object" && (v as { persisted?: unknown }).persisted === false);
}

export async function listRows<E extends Entity>(entity: E): Promise<AdminResult<{ rows: Row<E>[] }>> {
  const res = await request(`/api/admin/${entity}`);
  if (!res?.ok) return fail(res);
  const v: unknown = await res.json().catch(() => null);
  const rows = Array.isArray(v) ? v : (v as { results?: unknown } | null)?.results;
  if (!Array.isArray(rows)) return { ok: false, status: res.status, code: "bad_response", message: "", fields: {} };
  return { ok: true, persisted: persistedOf(res, v), rows: rows as Row<E>[] };
}

async function write<E extends Entity>(url: string, method: string, body?: unknown): Promise<AdminResult<{ row: Row<E> | null }>> {
  const res = await request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res?.ok) return fail(res);
  if (res.status === 204) return { ok: true, persisted: persistedOf(res, null), row: null };
  const v: unknown = await res.json().catch(() => null);
  const o = v as { row?: unknown; id?: unknown } | null;
  const row = (o?.row ?? (o && typeof o.id === "string" ? o : null)) as Row<E> | null;
  return { ok: true, persisted: persistedOf(res, v), row };
}

export const createRow = <E extends Entity>(entity: E, body: Body<E>) => write<E>(`/api/admin/${entity}`, "POST", body);
export const updateRow = <E extends Entity>(entity: E, id: string, patch: Record<string, unknown>) =>
  write<E>(`/api/admin/${entity}/${encodeURIComponent(id)}`, "PATCH", patch);
export const deleteRow = <E extends Entity>(entity: E, id: string) =>
  write<E>(`/api/admin/${entity}/${encodeURIComponent(id)}`, "DELETE");
