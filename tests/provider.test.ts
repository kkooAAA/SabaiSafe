// lib/ai/provider.ts: provider selection, missing keys, and the deterministic mock embedding.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, EMBEDDING_DIMS, aiProvider, chatModel, embed, embedMany, fastModel, mockEmbedding } from "@/lib/ai/provider";
import { computeVerdict } from "@/types/price-verdict";

afterEach(() => vi.unstubAllEnvs());

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

describe("aiProvider", () => {
  it("is mock in tests", () => expect(aiProvider()).toBe("mock"));
  it.each([["", "anthropic"], ["Anthropic", "anthropic"], [" openai ", "openai"], ["MOCK", "mock"]])("%j ⇒ %s", (v, want) => {
    vi.stubEnv("AI_PROVIDER", v);
    expect(aiProvider()).toBe(want);
  });
  it("throws AiUnavailableError for an unknown provider", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    expect(() => aiProvider()).toThrow(AiUnavailableError);
  });
  it("throws AiUnavailableError when the key is missing", () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => chatModel()).toThrow(AiUnavailableError);
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => fastModel()).toThrow(AiUnavailableError);
  });
  it("embeddings need OPENAI_API_KEY even with anthropic", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "x");
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(embed("hi")).rejects.toThrow(AiUnavailableError);
  });
});

describe("mock embedding", () => {
  it("is 1536-dim, unit length, deterministic", async () => {
    const a = await embed("motorbike rental deposit");
    expect(a).toHaveLength(EMBEDDING_DIMS);
    expect(Math.hypot(...a)).toBeCloseTo(1, 10);
    expect(await embed("motorbike rental deposit")).toEqual(a);
  });
  it("similar texts are closer than unrelated ones", () => {
    const q = mockEmbedding("motorbike rental passport deposit");
    expect(dot(q, mockEmbedding("rental of a motorbike, passport as deposit"))).toBeGreaterThan(dot(q, mockEmbedding("beach smoking ban fines")));
  });
  it("handles Chinese, Thai and empty text", () => {
    for (const t of ["租摩托车押金", "ตำรวจท่องเที่ยว", "", "!!!"]) {
      const v = mockEmbedding(t);
      expect(v).toHaveLength(EMBEDDING_DIMS);
      expect(Math.hypot(...v)).toBeCloseTo(1, 10);
    }
  });
  it("embedMany matches embed and handles []", async () => {
    expect(await embedMany([])).toEqual([]);
    expect(await embedMany(["a b", "c"])).toEqual([mockEmbedding("a b"), mockEmbedding("c")]);
  });
});

describe("computeVerdict", () => {
  it.each([
    [null, [100], "No price quoted"],
    [null, [], "Not enough data"],
    [100, [], "Not enough data"],
    [100, [100], "Within normal range"],
    [101, [100], "Above typical range"],
    [150, [100], "Above typical range"],
    [151, [100], "Far above typical range"],
    [300, [100, 300], "Within normal range"],
  ] as const)("quoted %j vs maxima %j ⇒ %s", (q, m, want) => expect(computeVerdict(q, [...m])).toBe(want));
});
