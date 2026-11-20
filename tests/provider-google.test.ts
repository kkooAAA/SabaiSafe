// lib/ai/provider.ts: Google provider, EMBEDDING_PROVIDER selection, key checks, vector normalization,
// embedding pacing, and the ingest hash folding (contracts v0.5). No network calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiUnavailableError,
  GOOGLE_EMBED_BATCH,
  MODEL_DEFAULTS,
  aiProvider,
  chatModel,
  embed,
  embeddingModelId,
  embeddingProvider,
  fastModel,
  googleEmbedPerMinute,
  normalizeVector,
  requireEmbeddingKey,
  reserveGoogleEmbeds,
  resetGoogleEmbedWindow,
} from "@/lib/ai/provider";
import { hashWithEmbeddingModel } from "@/lib/ai/ingest";

afterEach(() => {
  vi.unstubAllEnvs();
  resetGoogleEmbedWindow();
});

const FAKE = "test-not-a-real-key";

describe("AI_PROVIDER=google", () => {
  it("is accepted (any case/whitespace)", () => {
    vi.stubEnv("AI_PROVIDER", " Google ");
    expect(aiProvider()).toBe("google");
  });
  it("defaults are versioned, non-preview ids", () => {
    expect(MODEL_DEFAULTS.google).toEqual({ chat: "gemini-3.5-flash", fast: "gemini-3.5-flash-lite" });
  });
  it("missing key ⇒ AiUnavailableError (503)", () => {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    expect(() => chatModel()).toThrow(AiUnavailableError);
    expect(() => fastModel()).toThrow(AiUnavailableError);
  });
  it("uses the default ids, or AI_MODEL_CHAT / AI_MODEL_FAST", () => {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", FAKE);
    expect((chatModel() as { modelId: string }).modelId).toBe("gemini-3.5-flash");
    expect((fastModel() as { modelId: string }).modelId).toBe("gemini-3.5-flash-lite");
    vi.stubEnv("AI_MODEL_CHAT", "gemini-2.5-flash");
    vi.stubEnv("AI_MODEL_FAST", "gemini-2.5-flash-lite");
    expect((chatModel() as { modelId: string }).modelId).toBe("gemini-2.5-flash");
    expect((fastModel() as { modelId: string }).modelId).toBe("gemini-2.5-flash-lite");
  });
});

describe("EMBEDDING_PROVIDER", () => {
  it.each([
    ["google", "", "google"],
    ["anthropic", "", "openai"],
    ["openai", "", "openai"],
    ["google", "openai", "openai"],
    ["anthropic", " GOOGLE ", "google"],
  ])("AI_PROVIDER=%s EMBEDDING_PROVIDER=%j ⇒ %s", (ai, emb, want) => {
    vi.stubEnv("AI_PROVIDER", ai);
    vi.stubEnv("EMBEDDING_PROVIDER", emb);
    expect(embeddingProvider()).toBe(want);
  });
  it("an unknown value ⇒ AiUnavailableError", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "cohere");
    expect(() => embeddingProvider()).toThrow(AiUnavailableError);
  });
  it("embeddingModelId names the vector space", () => {
    expect(embeddingModelId()).toBe("mock"); // tests run with AI_PROVIDER=mock
    vi.stubEnv("AI_PROVIDER", "google");
    expect(embeddingModelId()).toBe("google:gemini-embedding-001@1536");
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    expect(embeddingModelId()).toBe("openai:text-embedding-3-small");
  });
  it("requireEmbeddingKey checks the key of the EMBEDDING provider", () => {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", FAKE);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => requireEmbeddingKey()).not.toThrow();
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    expect(() => requireEmbeddingKey()).toThrow(AiUnavailableError);
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("EMBEDDING_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    expect(() => requireEmbeddingKey()).toThrow(AiUnavailableError);
  });
  it("mock mode needs no key and never calls a provider", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => requireEmbeddingKey()).not.toThrow();
    expect(await embed("hello", { task: "query" })).toHaveLength(1536);
  });
  it("google embed without a key rejects before any network call", async () => {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    await expect(embed("hi")).rejects.toThrow(AiUnavailableError);
  });
});

describe("normalizeVector", () => {
  it("scales to unit length and keeps direction", () => {
    const v = normalizeVector([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(Math.hypot(...normalizeVector(Array.from({ length: 1536 }, (_, i) => (i % 7) - 3)))).toBeCloseTo(1, 10);
  });
  it("leaves a zero vector alone", () => expect(normalizeVector([0, 0])).toEqual([0, 0]));
});

describe("Google embedding pacing (free tier counts each text)", () => {
  const clock = () => {
    let t = 0;
    const waits: number[] = [];
    return { now: () => t, wait: async (ms: number) => void (waits.push(ms), (t += ms)), waits, tick: (ms: number) => (t += ms) };
  };
  it("defaults: batch 50, 90 texts per minute; GOOGLE_EMBED_PER_MIN override, values below one batch ignored", () => {
    expect(GOOGLE_EMBED_BATCH).toBe(50);
    expect(googleEmbedPerMinute()).toBe(90);
    vi.stubEnv("GOOGLE_EMBED_PER_MIN", "1400");
    expect(googleEmbedPerMinute()).toBe(1400);
    vi.stubEnv("GOOGLE_EMBED_PER_MIN", "10");
    expect(googleEmbedPerMinute()).toBe(90);
  });
  it("no wait while under the limit", async () => {
    const c = clock();
    await reserveGoogleEmbeds(50, 90, c.now, c.wait);
    await reserveGoogleEmbeds(40, 90, c.now, c.wait);
    expect(c.waits).toEqual([]);
  });
  it("waits until the oldest texts leave the one-minute window (128 chunks ⇒ one wait)", async () => {
    const c = clock();
    await reserveGoogleEmbeds(50, 90, c.now, c.wait);
    await reserveGoogleEmbeds(40, 90, c.now, c.wait);
    c.tick(5_000);
    await reserveGoogleEmbeds(28, 90, c.now, c.wait);
    expect(c.waits).toEqual([55_250]);
    expect(c.now()).toBe(60_250);
  });
});

describe("ingest hash includes the embedding model", () => {
  it("different models ⇒ different stored hashes; same model ⇒ stable", () => {
    const h = "a".repeat(64);
    const g = hashWithEmbeddingModel(h, "google:gemini-embedding-001@1536");
    expect(g).toMatch(/^[0-9a-f]{64}$/);
    expect(g).toBe(hashWithEmbeddingModel(h, "google:gemini-embedding-001@1536"));
    expect(g).not.toBe(hashWithEmbeddingModel(h, "openai:text-embedding-3-small"));
    expect(g).not.toBe(h);
  });
});

describe("legal similarity threshold per embedding model", () => {
  it("google 0.62, openai and mock 0.30, unknown id 0.30", async () => {
    const { minSimilarity, DEFAULT_MIN_SIMILARITY } = await import("@/lib/ai/constants");
    vi.stubEnv("LEGAL_MIN_SIMILARITY", "");
    expect(DEFAULT_MIN_SIMILARITY).toBe(0.3);
    expect(minSimilarity("google:gemini-embedding-001@1536")).toBe(0.62);
    expect(minSimilarity("openai:text-embedding-3-small")).toBe(0.3);
    expect(minSimilarity("mock")).toBe(0.3);
    expect(minSimilarity("something-else")).toBe(0.3);
    expect(minSimilarity()).toBe(0.3);
  });
  it("LEGAL_MIN_SIMILARITY overrides every model; invalid values are ignored", async () => {
    const { minSimilarity } = await import("@/lib/ai/constants");
    vi.stubEnv("LEGAL_MIN_SIMILARITY", "0.45");
    expect(minSimilarity("google:gemini-embedding-001@1536")).toBe(0.45);
    expect(minSimilarity("openai:text-embedding-3-small")).toBe(0.45);
    for (const bad of ["0", "1", "-0.2", "abc", "  "]) {
      vi.stubEnv("LEGAL_MIN_SIMILARITY", bad);
      expect(minSimilarity("google:gemini-embedding-001@1536")).toBe(0.62);
    }
  });
  it("the threshold follows the active embedding model id", async () => {
    const { minSimilarity } = await import("@/lib/ai/constants");
    vi.stubEnv("LEGAL_MIN_SIMILARITY", "");
    vi.stubEnv("AI_PROVIDER", "google");
    expect(minSimilarity(embeddingModelId())).toBe(0.62);
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    expect(minSimilarity(embeddingModelId())).toBe(0.3);
  });
});
