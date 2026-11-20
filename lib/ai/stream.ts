// Plain-text streaming responses for the AI routes (contracts §3.1, §3.2, §3.7).
//
// Wire format guarantees:
//   - text/plain; charset=utf-8, chunked, no-store.
//   - \u001e is stripped from model text, so SOURCES_DELIMITER / ERROR_MARKER can't be faked by the model.
//   - trailer (if given): SOURCES_DELIMITER + one JSON line + "\n", after the text.
//   - ready mode: any "[READY]" in model text is removed; if one was seen, the body ends with exactly
//     "\n[READY]". Partial tokens ("[REA") and trailing whitespace are held back, so they never flash.
//   - failure after streaming started: held text is flushed, then ERROR_MARKER, then the stream closes.
//     No trailer and no READY token follow ERROR_MARKER.
import { ERROR_MARKER, READY_TOKEN, SOURCES_DELIMITER } from "@/types/api";

/** Minimal shape of streamText's `stream` parts that we consume. */
export type StreamPartLike = { type: string; text?: string; error?: unknown };

/** Text deltas of a streamText result; throws on an error part so failures reach the response writer. */
export async function* textDeltas(parts: AsyncIterable<StreamPartLike>): AsyncGenerator<string> {
  for await (const p of parts) {
    if (p.type === "text-delta" && typeof p.text === "string") yield p.text;
    else if (p.type === "error") throw p.error instanceof Error ? p.error : new Error(String(p.error));
  }
}

/** A fixed string as an async iterable (for answers that don't call a model, e.g. no_answer). */
export async function* fixedText(text: string): AsyncGenerator<string> {
  yield text;
}

const RS = /\u001e/g;

/** Holds back a possible "[READY]" prefix and trailing whitespace; strips complete tokens. */
export class ReadyNormalizer {
  private held = "";
  sawReady = false;

  /** Returns the text that is safe to emit now. */
  push(delta: string): string {
    let buf = this.held + delta;
    // Loop: stripping a nested token ("[REA[READY]DY]") can form a new one.
    while (buf.includes(READY_TOKEN)) {
      this.sawReady = true;
      buf = buf.split(READY_TOKEN).join("");
    }
    const keep = holdLength(buf);
    this.held = buf.slice(buf.length - keep);
    return buf.slice(0, buf.length - keep);
  }

  /** Text to emit at the end. With `ok`, a seen token becomes the exact suffix "\n[READY]". */
  end(ok: boolean): string {
    const rest = this.held;
    this.held = "";
    if (ok && this.sawReady) return `${rest.trimEnd()}\n${READY_TOKEN}`;
    // Not ready (or failed): drop a dangling partial token, keep real text.
    return rest.replace(partialTokenSuffix(rest), "");
  }
}

function partialTokenSuffix(s: string): RegExp | string {
  for (let n = Math.min(READY_TOKEN.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(READY_TOKEN.slice(0, n))) return new RegExp(`${escapeRe(READY_TOKEN.slice(0, n))}$`);
  }
  return "";
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How far back an unclosed "[" is still held (bounds the delay for text with a stray "["). */
const BRACKET_WINDOW = 64;

/**
 * Length of the suffix to hold back: trailing whitespace, optionally after a partial "[READY"; and everything from
 * the earliest unclosed "[" in the last BRACKET_WINDOW chars. The second rule matters for nested tokens: if
 * "x [REA" were sent and "[READY]DY]" arrived next, stripping the inner token would complete "[READY]" on the wire.
 * `buf` never contains a whole token here, so every "]" in it is real and closes any earlier "[".
 */
function holdLength(buf: string): number {
  let end = buf.length;
  for (let n = Math.min(READY_TOKEN.length - 1, buf.length); n > 0; n--) {
    if (buf.endsWith(READY_TOKEN.slice(0, n))) {
      end = buf.length - n;
      break;
    }
  }
  let start = end;
  while (start > 0 && /\s/.test(buf[start - 1]!)) start--;
  const lastClose = buf.lastIndexOf("]");
  const openFrom = buf.indexOf("[", Math.max(lastClose + 1, buf.length - BRACKET_WINDOW));
  if (openFrom >= 0 && openFrom < start) start = openFrom;
  return buf.length - start;
}

export type StreamOptions = {
  /** Called after the text finished without error; its JSON goes after SOURCES_DELIMITER. */
  trailer?: () => unknown | Promise<unknown>;
  /** Normalize the [READY] token (report interview). */
  ready?: boolean;
  /** Called with the error when the stream fails after it started (for logging). */
  onError?: (err: unknown) => void;
};

export const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/** Builds the ReadableStream body (exported separately so it can be unit-tested). */
export function toTextBody(deltas: AsyncIterable<string>, opts: StreamOptions = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const ready = opts.ready ? new ReadyNormalizer() : null;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        if (s) controller.enqueue(enc.encode(s));
      };
      try {
        for await (const raw of deltas) {
          const d = raw.replace(RS, "");
          send(ready ? ready.push(d) : d);
        }
        if (ready) send(ready.end(true));
        if (opts.trailer) send(SOURCES_DELIMITER + JSON.stringify(await opts.trailer()) + "\n");
      } catch (err) {
        opts.onError?.(err);
        if (ready) send(ready.end(false));
        send(ERROR_MARKER);
      }
      controller.close();
    },
  });
}

export function textStreamResponse(deltas: AsyncIterable<string>, opts: StreamOptions = {}): Response {
  return new Response(toTextBody(deltas, opts), { status: 200, headers: STREAM_HEADERS });
}
