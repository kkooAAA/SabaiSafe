// Client-side reader for ai's plain-text streams (contracts §3; ERROR_MARKER from types/protocol.ts).
// The pure part (splitErrorMarker) is unit-testable without fetch.
import { ERROR_MARKER } from "@/types/protocol";
import type { ApiError } from "@/types/api";

/** Text before ERROR_MARKER and whether the marker was seen. While streaming, hides a partial marker prefix at the end. */
export function splitErrorMarker(buf: string, done = false): { text: string; error: boolean } {
  const i = buf.indexOf(ERROR_MARKER);
  if (i >= 0) return { text: buf.slice(0, i), error: true };
  if (!done) {
    // Hold back a trailing prefix of the marker (e.g. "\n\u001eERR") so it never flashes.
    for (let n = Math.min(ERROR_MARKER.length - 1, buf.length); n > 0; n--) {
      if (buf.endsWith(ERROR_MARKER.slice(0, n))) return { text: buf.slice(0, buf.length - n), error: false };
    }
  }
  return { text: buf, error: false };
}

export type StreamResult =
  | { ok: true; text: string; error: boolean }
  | { ok: false; status: number; code: string };

/**
 * POST JSON and stream the text body. onText gets the visible text so far.
 * Non-2xx → { ok:false, code } from the §3 error shape. Abort via `signal` (throws AbortError).
 */
export async function postTextStream(
  url: string,
  body: unknown,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let code = "internal";
    try {
      code = ((await res.json()) as ApiError).error.code ?? code;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, status: res.status, code };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const part = splitErrorMarker(buf);
    onText(part.text);
    if (part.error) {
      await reader.cancel().catch(() => {});
      return { ok: true, text: part.text, error: true };
    }
  }
  buf += decoder.decode();
  const final = splitErrorMarker(buf, true);
  onText(final.text);
  return { ok: true, text: final.text, error: final.error };
}

/**
 * Message key (under `errors` / `report.errors`) for a failed AI request, or null for "not an AI-capacity error".
 * 503 `unavailable` from the AI routes means the provider is busy or out of quota: "busy, try again in a minute".
 */
export function aiErrorKey(status: number, code: string | null | undefined): "busy" | "rate_limited" | null {
  if (status === 429 || code === "rate_limited") return "rate_limited";
  if (status === 503 || code === "unavailable") return "busy";
  return null;
}
