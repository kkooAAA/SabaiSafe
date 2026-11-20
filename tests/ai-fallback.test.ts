// lib/ai/fallback.ts + provider wiring: Gemini fail-fast (maxRetries 0), one-shot fallback on 429/5xx before output,
// busy → 503 mapping, primeDeltas, AI_DEBUG diagnostics, UPSTREAMBUSY mock trigger. No network calls.
import { APICallError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiCallErrorOf,
  debugFetch,
  isBusyError,
  isDailyQuotaError,
  withFallback,
  type LanguageModelV4,
} from "@/lib/ai/fallback";
import { errorResponse } from "@/lib/ai/http";
import { GOOGLE_EMBED_MAX_RETRIES, chatModel, fastModel, googleFallbackId, modelCallOptions } from "@/lib/ai/provider";
import { primeDeltas } from "@/lib/ai/stream";
import { ERROR_MARKER } from "@/types/api";
import * as chatRoute from "@/app/api/chat/route";
import * as priceRoute from "@/app/api/chat/price/route";
import * as reportChatRoute from "@/app/api/report/chat/route";
import * as generateRoute from "@/app/api/report/generate/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const apiError = (statusCode: number, body = "{}") =>
  new APICallError({ message: `HTTP ${statusCode}`, url: "https://example.invalid/v1beta/models/x:generateContent", requestBodyValues: {}, statusCode, responseBody: body });

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const okGenerate = (text: string) => async () => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
  warnings: [],
});
const okStream = (text: string) => async () => ({
  stream: new ReadableStream({
    start(c) {
      c.enqueue({ type: "text-start", id: "t" });
      c.enqueue({ type: "text-delta", id: "t", delta: text });
      c.enqueue({ type: "text-end", id: "t" });
      c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
      c.close();
    },
  }),
});
const failing = (err: unknown) => async () => {
  throw err;
};
const model = (id: string, gen: () => Promise<unknown>, stream?: () => Promise<unknown>) =>
  new MockLanguageModelV4({
    modelId: id,
    doGenerate: gen as never,
    doStream: (stream ?? failing(new Error("no stream"))) as never,
  }) as unknown as LanguageModelV4;
const callOpts = { prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }] } as never;

describe("error classification", () => {
  it.each([429, 500, 502, 503, 504])("%i is busy", (s) => expect(isBusyError(apiError(s))).toBe(true));
  it.each([400, 401, 403, 404])("%i is not busy", (s) => expect(isBusyError(apiError(s))).toBe(false));
  it("non-API errors are not busy", () => {
    expect(isBusyError(new Error("x"))).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
  it("looks through RetryError.lastError and cause", () => {
    const e = apiError(503);
    const retry = new RetryError({ message: "failed", reason: "maxRetriesExceeded", errors: [e] });
    expect(apiCallErrorOf(retry)).toBe(e);
    expect(isBusyError(new Error("wrapped", { cause: e }))).toBe(true);
  });
  it("daily quota is a 429 whose body names a PerDay quota", () => {
    expect(isDailyQuotaError(apiError(429, '{"error":{"message":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}'))).toBe(true);
    expect(isDailyQuotaError(apiError(429, '{"error":{"message":"GenerateRequestsPerMinutePerProjectPerModel"}}'))).toBe(false);
    expect(isDailyQuotaError(apiError(503, "PerDay"))).toBe(false);
  });
});

describe("withFallback", () => {
  it("primary OK ⇒ fallback never called", async () => {
    const fb = vi.fn(okGenerate("fallback"));
    const m = withFallback(model("p", okGenerate("primary")), model("f", fb));
    const r = await m.doGenerate(callOpts);
    expect(r.content).toEqual([{ type: "text", text: "primary" }]);
    expect(fb).not.toHaveBeenCalled();
    expect(m.modelId).toBe("p");
  });
  it.each([429, 503, 500])("generate: primary %i ⇒ fallback once", async (s) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fb = vi.fn(okGenerate("fallback"));
    const r = await withFallback(model("p", failing(apiError(s))), model("f", fb)).doGenerate(callOpts);
    expect(r.content).toEqual([{ type: "text", text: "fallback" }]);
    expect(fb).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 404])("generate: primary %i ⇒ no fallback, error rethrown", async (s) => {
    const fb = vi.fn(okGenerate("fallback"));
    await expect(withFallback(model("p", failing(apiError(s))), model("f", fb)).doGenerate(callOpts)).rejects.toThrow(`HTTP ${s}`);
    expect(fb).not.toHaveBeenCalled();
  });
  it("both busy (daily quota) ⇒ fallback's error, immediately (no waiting)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const quota = apiError(429, "GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    const t0 = Date.now();
    const err = await Promise.resolve(
      withFallback(model("p", failing(apiError(429, "PerDay"))), model("f", failing(quota))).doGenerate(callOpts),
    ).catch((e: unknown) => e);
    expect(err).toBe(quota);
    expect(isDailyQuotaError(err)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("stream: primary 503 before the stream exists ⇒ fallback stream", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = withFallback(model("p", okGenerate("x"), failing(apiError(503))), model("f", okGenerate("x"), okStream("from fallback")));
    const { stream } = await m.doStream(callOpts);
    const parts: { type: string; delta?: string }[] = [];
    const reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value as never);
    expect(parts.filter((p) => p.type === "text-delta").map((p) => p.delta)).toEqual(["from fallback"]);
  });
  it("aborted request ⇒ no fallback", async () => {
    const fb = vi.fn(okGenerate("fallback"));
    const ac = new AbortController();
    ac.abort();
    await expect(
      withFallback(model("p", failing(apiError(503))), model("f", fb)).doGenerate({ ...(callOpts as object), abortSignal: ac.signal } as never),
    ).rejects.toThrow();
    expect(fb).not.toHaveBeenCalled();
  });
});

describe("provider wiring (no network)", () => {
  it("google calls: maxRetries 0 + minimal thinking; other providers: SDK defaults", () => {
    vi.stubEnv("AI_PROVIDER", "google");
    expect(modelCallOptions()).toEqual({
      maxRetries: 0,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } } },
    });
    vi.stubEnv("AI_PROVIDER", "anthropic");
    expect(modelCallOptions()).toEqual({});
    vi.stubEnv("AI_PROVIDER", "mock");
    expect(modelCallOptions()).toEqual({});
  });
  it("embeddings retry once on google", () => expect(GOOGLE_EMBED_MAX_RETRIES).toBe(1));
  it("fallback ids", () => {
    expect(googleFallbackId("gemini-3.5-flash")).toBe("gemini-3.5-flash-lite");
    expect(googleFallbackId("gemini-3.5-flash-lite")).toBe("gemini-3.5-flash");
    vi.stubEnv("AI_MODEL_FALLBACK", "gemini-x");
    expect(googleFallbackId("gemini-3.5-flash")).toBe("gemini-x");
    expect(googleFallbackId("gemini-x")).toBeNull();
  });
  it("google chat/fast models keep the primary model id (wrapper is transparent)", () => {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-not-a-real-key");
    expect((chatModel() as { modelId: string }).modelId).toBe("gemini-3.5-flash");
    expect((fastModel() as { modelId: string }).modelId).toBe("gemini-3.5-flash-lite");
  });
});

describe("errorResponse", () => {
  it.each([429, 503])("upstream %i (also inside RetryError) ⇒ 503 unavailable", async (s) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const err of [apiError(s), new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [apiError(s)] })]) {
      const res = errorResponse(err);
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("unavailable");
    }
  });
  it("upstream 400 ⇒ 500 internal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(errorResponse(apiError(400)).status).toBe(500);
  });
});

describe("primeDeltas", () => {
  async function* gen(parts: string[], throwAt?: number) {
    for (let i = 0; i < parts.length; i++) {
      if (i === throwAt) throw new Error("boom");
      yield parts[i]!;
    }
  }
  const all = async (it: AsyncIterable<string>) => {
    let s = "";
    for await (const x of it) s += x;
    return s;
  };
  it("passes everything through", async () => expect(await all(await primeDeltas(gen(["a", "b", "c"])))).toBe("abc"));
  it("an error before the first delta rejects the prime itself", async () =>
    expect(primeDeltas(gen(["a"], 0))).rejects.toThrow("boom"));
  it("an error after the first delta surfaces later, during iteration", async () => {
    const it = await primeDeltas(gen(["a", "b"], 1));
    await expect(all(it)).rejects.toThrow("boom");
  });
  it("empty source ⇒ empty", async () => expect(await all(await primeDeltas(gen([]))) ).toBe(""));
});

describe("AI_DEBUG diagnostics fetch", () => {
  const fakeFetch = (status: number, headers: Record<string, string> = {}) =>
    (async () => new Response("{}", { status, headers })) as unknown as typeof fetch;
  it("silent unless AI_DEBUG=1", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await debugFetch(fakeFetch(200))("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
    expect(info).not.toHaveBeenCalled();
  });
  it("logs model, op, status, ms, retry-after, and nothing else", async () => {
    vi.stubEnv("AI_DEBUG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await debugFetch(fakeFetch(429, { "retry-after": "17" }))(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=SHOULD-NOT-APPEAR",
      { headers: { "x-goog-api-key": "SHOULD-NOT-APPEAR" }, body: "SHOULD-NOT-APPEAR" },
    );
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toMatch(/^\[ai-debug\] google model=gemini-3\.5-flash op=streamGenerateContent status=429 ms=\d+ retry-after=17$/);
    expect(line).not.toContain("SHOULD-NOT-APPEAR");
    expect(line).not.toContain("http");
  });
});

describe("UPSTREAMBUSY mock trigger ⇒ 503 unavailable JSON (no stream)", () => {
  const post = (h: { POST: (r: Request) => Promise<Response> }, body: unknown) =>
    h.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
  const quiet = () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  };
  it("/api/chat", async () => {
    quiet();
    const res = await post(chatRoute, { question: "motorbike rental passport deposit UPSTREAMBUSY", lang: "en" });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("unavailable");
  });
  it("/api/chat/price", async () => {
    quiet();
    const res = await post(priceRoute, { item: "UPSTREAMBUSY taxi", quoted: 900, area: null, lang: "en" });
    expect(res.status).toBe(503);
  });
  it("/api/report/chat", async () => {
    quiet();
    const res = await post(reportChatRoute, { messages: [{ role: "user", content: "UPSTREAMBUSY my bag" }], lang: "en" });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(ERROR_MARKER);
  });
  it("/api/report/generate", async () => {
    quiet();
    const res = await post(generateRoute, { messages: [{ role: "user", content: "UPSTREAMBUSY my bag" }] });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("unavailable");
  });
  it("STREAMERROR (fails after the first chunk) still ends a 200 stream with ERROR_MARKER", async () => {
    quiet();
    const res = await post(reportChatRoute, { messages: [{ role: "user", content: "STREAMERROR" }], lang: "en" });
    expect(res.status).toBe(200);
    expect((await res.text()).endsWith(ERROR_MARKER)).toBe(true);
  });
});

// qa additions: no fallback once output has started (the user would see two different answers glued together).
describe("withFallback after output started", () => {
  it("stream: primary errors AFTER its first delta ⇒ the fallback is never called, the error reaches the reader", async () => {
    const fbStream = vi.fn(okStream("from fallback"));
    const midStreamFail = async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: "partial" });
          c.enqueue({ type: "error", error: apiError(503) });
          c.close();
        },
      }),
    });
    const m = withFallback(model("p", okGenerate("x"), midStreamFail), model("f", okGenerate("x"), fbStream));
    const { stream } = await m.doStream(callOpts);
    const parts: { type: string; delta?: string }[] = [];
    const reader = stream.getReader();
    try {
      for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value as never);
    } catch {
      /* an errored stream is also acceptable */
    }
    expect(parts.filter((p) => p.type === "text-delta").map((p) => p.delta)).toEqual(["partial"]);
    expect(fbStream).not.toHaveBeenCalled();
  });

  it("a busy error never reveals upstream details in the 503 body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = errorResponse(apiError(429, '{"error":{"message":"GenerateRequestsPerDayPerProjectPerModel-FreeTier quota_project_id=123"}}'));
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).not.toMatch(/PerDay|quota_project|example\.invalid|googleapis/);
  });
});
