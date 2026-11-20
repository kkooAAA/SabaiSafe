// Thin fetch wrappers for the report routes (contracts §3.3–3.5a). Errors are returned, never thrown,
// except AbortError (so callers can tell Stop from a failure).
import type { ApiError, ReportFacts, ReportGenerateResponse } from "@/types/api";
import { pdfFilename, type Msg, type ReportSaveBody, type SavedReport } from "./report-state";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

async function errorOf(res: Response): Promise<{ ok: false; status: number; code: string }> {
  let code = "internal";
  try {
    code = ((await res.json()) as ApiError).error.code ?? code;
  } catch {
    /* non-JSON body */
  }
  return { ok: false, status: res.status, code };
}

async function call<T>(url: string, init: RequestInit, read: (res: Response) => Promise<T>): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { ok: false, status: 0, code: "network" };
  }
  if (!res.ok) return errorOf(res);
  try {
    return { ok: true, data: await read(res) };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { ok: false, status: res.status, code: "bad_response" };
  }
}

const json = (body: unknown, extra?: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...extra },
  body: JSON.stringify(body),
});

export type Summary = { facts: ReportFacts; markdown: string };

function asSummary(v: unknown): Summary {
  const o = v as Partial<ReportGenerateResponse> | null;
  if (!o || typeof o.markdown !== "string" || !o.markdown.trim() || !o.facts || typeof o.facts !== "object") {
    throw new Error("bad_response");
  }
  return { facts: o.facts, markdown: o.markdown };
}

export function generateSummary(body: { messages: Msg[] }, signal?: AbortSignal): Promise<ApiResult<Summary>> {
  return call("/api/report/generate", { ...json(body), signal }, async (r) => asSummary(await r.json()));
}

export function fetchPdf(summary: Summary): Promise<ApiResult<{ blob: Blob; filename: string }>> {
  return call("/api/report/pdf", json({ markdown: summary.markdown, facts: summary.facts }), async (r) => ({
    blob: await r.blob(),
    filename: pdfFilename(r.headers.get("Content-Disposition")),
  }));
}

export function saveSummary(body: ReportSaveBody): Promise<ApiResult<SavedReport>> {
  return call("/api/report/save", json(body), async (r) => {
    const v = (await r.json()) as Partial<SavedReport>;
    if (typeof v.id !== "string" || typeof v.delete_token !== "string" || typeof v.expires_at !== "string") {
      throw new Error("bad_response");
    }
    return { id: v.id, delete_token: v.delete_token, expires_at: v.expires_at };
  });
}

export function openSaved(saved: SavedReport): Promise<ApiResult<Summary & { expires_at: string }>> {
  return call(
    `/api/report/${encodeURIComponent(saved.id)}`,
    { method: "GET", headers: { "x-delete-token": saved.delete_token }, cache: "no-store" },
    async (r) => {
      const v = (await r.json()) as { expires_at?: unknown };
      return { ...asSummary(v), expires_at: typeof v.expires_at === "string" ? v.expires_at : saved.expires_at };
    },
  );
}

export function deleteSaved(saved: SavedReport): Promise<ApiResult<null>> {
  return call(
    `/api/report/${encodeURIComponent(saved.id)}`,
    { method: "DELETE", headers: { "x-delete-token": saved.delete_token } },
    async () => null,
  );
}

/** Triggers a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
