// Fail-fast + fallback for Gemini's free tier (lead-approved 2026-11-20).
// - Google calls run with maxRetries 0 (provider.ts#modelCallOptions): the SDK would otherwise retry 429/503 twice,
//   honouring retry-after up to 60 s each, which made single requests take minutes.
// - withFallback(): if the primary model fails BEFORE producing output with a "busy" error (429 or 5xx), the same
//   request goes once to the fallback model (a different free-tier quota bucket). A per-minute 429 that asks for a
//   short wait (<= GOOGLE_RETRY_MAX_WAIT_MS, default 5 s) first gets one wait + one retry of the primary.
//   Errors after a stream has started are never retried, so text is never duplicated.
// - isBusyError() lets routes map an upstream 429/5xx to 503 `unavailable` (lib/ai/http.ts).
import { APICallError, type LanguageModel } from "ai";

export type LanguageModelV4 = Extract<LanguageModel, { specificationVersion: "v4" }>;

/** The APICallError behind an error, looking through RetryError (lastError) and `cause`. */
export function apiCallErrorOf(err: unknown, depth = 0): APICallError | null {
  if (depth > 4 || err === null || typeof err !== "object") return null;
  if (APICallError.isInstance(err)) return err;
  const e = err as { lastError?: unknown; cause?: unknown };
  return apiCallErrorOf(e.lastError, depth + 1) ?? apiCallErrorOf(e.cause, depth + 1);
}

/** Upstream rate limit / quota (429) or server-side overload/failure (5xx). */
export function isBusyError(err: unknown): boolean {
  const status = apiCallErrorOf(err)?.statusCode;
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

/** A per-day free-tier quota 429 (e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier). Retrying today won't help. */
export function isDailyQuotaError(err: unknown): boolean {
  const e = apiCallErrorOf(err);
  return e?.statusCode === 429 && /PerDay/i.test(e.responseBody ?? e.message);
}

/**
 * The server's suggested wait, in ms: retry-after-ms / retry-after header, else Google's RetryInfo.retryDelay
 * ("17s", "0.5s") in the error body, else "Please retry in 48.4s" in the message. null if none is given.
 */
export function retryDelayMs(err: unknown): number | null {
  const e = apiCallErrorOf(err);
  if (!e) return null;
  const h = e.responseHeaders ?? {};
  const ms = Number(h["retry-after-ms"]);
  if (h["retry-after-ms"] && Number.isFinite(ms) && ms >= 0) return ms;
  const sec = Number(h["retry-after"]);
  if (h["retry-after"] && Number.isFinite(sec) && sec >= 0) return sec * 1000;
  const text = `${e.responseBody ?? ""} ${e.message}`;
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text) ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(text);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/** Longest wait for a per-minute 429 before retrying the same model once (GOOGLE_RETRY_MAX_WAIT_MS, default 5000). */
export function retryMaxWaitMs(): number {
  const v = Math.floor(Number(process.env.GOOGLE_RETRY_MAX_WAIT_MS));
  return Number.isFinite(v) && v >= 0 && v <= 30_000 ? v : 5000;
}

/** A per-minute 429 whose suggested wait is short enough to sit out once. Daily quota never qualifies. */
export function shortRateLimitWaitMs(err: unknown, maxWaitMs = retryMaxWaitMs()): number | null {
  if (apiCallErrorOf(err)?.statusCode !== 429 || isDailyQuotaError(err)) return null;
  const d = retryDelayMs(err);
  return d !== null && d <= maxWaitMs ? d : null;
}

function describe(err: unknown): string {
  const e = apiCallErrorOf(err);
  return e ? `${e.statusCode ?? "?"}${isDailyQuotaError(err) ? " (daily quota)" : ""}` : "error";
}

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });

export type FallbackOptions = {
  maxWaitMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * A model that delegates to `primary`. On a busy error before any output:
 *   1. a per-minute 429 asking for <= maxWaitMs: wait once, retry the primary once;
 *   2. otherwise (or if that retry is busy too): call `fallback` once. Its error, if any, is final.
 * Model id / provider / supported URLs are the primary's.
 */
export function withFallback(
  primary: LanguageModelV4,
  fallback: LanguageModelV4,
  opts: FallbackOptions = {},
): LanguageModelV4 {
  const sleep = opts.sleep ?? abortableSleep;
  const note = (err: unknown) =>
    console.warn(`[ai] ${primary.modelId} failed (${describe(err)}); falling back to ${fallback.modelId}`);

  async function run<T>(call: (m: LanguageModelV4) => PromiseLike<T>, signal?: AbortSignal): Promise<T> {
    let err: unknown;
    try {
      return await call(primary);
    } catch (e) {
      err = e;
    }
    if (!isBusyError(err) || signal?.aborted) throw err;
    const wait = shortRateLimitWaitMs(err, opts.maxWaitMs ?? retryMaxWaitMs());
    if (wait !== null) {
      console.warn(`[ai] ${primary.modelId} rate-limited; retrying once in ${wait} ms`);
      await sleep(wait, signal);
      try {
        return await call(primary);
      } catch (e) {
        err = e;
      }
      if (!isBusyError(err) || signal?.aborted) throw err;
    }
    note(err);
    return call(fallback);
  }

  return {
    specificationVersion: "v4",
    provider: primary.provider,
    modelId: primary.modelId,
    get supportedUrls() {
      return primary.supportedUrls;
    },
    doGenerate: (options) => run((m) => m.doGenerate(options), options.abortSignal),
    // HTTP errors (429/503) are thrown by doStream, before the stream exists; mid-stream errors are stream parts.
    doStream: (options) => run((m) => m.doStream(options), options.abortSignal),
  };
}

/**
 * Diagnostics for the Google provider (AI_DEBUG=1 only): one line per HTTP call with the model, operation, status,
 * time to response headers and retry-after. Never logs the URL (with query), headers, bodies or the key.
 */
export function debugFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    if (process.env.AI_DEBUG !== "1") return base(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = /\/models\/([\w.-]+):(\w+)/.exec(new URL(url).pathname);
    const label = m ? `model=${m[1]} op=${m[2]}` : "model=? op=?";
    const t0 = Date.now();
    try {
      const res = await base(input, init);
      const ra = res.headers.get("retry-after-ms") ?? res.headers.get("retry-after");
      console.info(`[ai-debug] google ${label} status=${res.status} ms=${Date.now() - t0}${ra ? ` retry-after=${ra}` : ""}`);
      return res;
    } catch (err) {
      console.info(`[ai-debug] google ${label} status=network-error ms=${Date.now() - t0}`);
      throw err;
    }
  };
}
