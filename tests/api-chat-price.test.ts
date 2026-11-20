// POST /api/chat/price with AI_PROVIDER=mock (the verdict line is computed in code from the refs).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/price/route";
import * as route from "@/app/api/chat/price/route";
import { resetSampleCache } from "@/lib/db/sample";
import { ERROR_MARKER, SOURCES_DELIMITER, type ApiError } from "@/types/api";
import { inventedNumbers } from "./helpers/phones";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/chat/price", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

async function text(res: Response) {
  return await res.text();
}

beforeAll(() => {
  vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/content");
  resetSampleCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetSampleCache();
});

describe("POST /api/chat/price", () => {
  it("declares the node runtime", () => expect(route.runtime).toBe("nodejs"));

  it("streams text/plain with no SOURCES trailer", async () => {
    const res = await post({ item: "jetski_30min", quoted: 1200, area: "Patong", lang: "en" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const t = await text(res);
    expect(t).not.toContain(SOURCES_DELIMITER);
    expect(t).not.toContain(ERROR_MARKER);
  });

  // Fixture: jetski_30min @ Patong = 1000–1500 THB. Far above = > 1.5 × 1500 = 2250.
  it.each([
    [1000, "Within normal range"],
    [1500, "Within normal range"],
    [1501, "Above typical range"],
    [2250, "Above typical range"],
    [2251, "Far above typical range"],
  ])("quoted %d THB ⇒ %s", async (quoted, verdict) => {
    const t = await text(await post({ item: "jetski_30min", quoted, area: "Patong", lang: "en" }));
    expect(t.split("\n")[0]).toBe(`Verdict: ${verdict}`);
  });

  it("no matching refs ⇒ Not enough data (the model still runs)", async () => {
    const t = await text(await post({ item: "helicopter tour", quoted: 5000, lang: "en" }));
    expect(t.split("\n")[0]).toBe("Verdict: Not enough data");
  });

  it("answers in Chinese for lang=zh", async () => {
    const t = await text(await post({ item: "jetski_30min", quoted: 3000, area: "Patong", lang: "zh" }));
    expect(t).toMatch(/远高于常见范围/);
  });

  it("mentions only hotline numbers", async () => {
    const t = await text(await post({ item: "jetski_30min", quoted: 3000, area: "Patong", lang: "en" }));
    expect(inventedNumbers(t)).toEqual([]);
  });

  it("a daily quote is not judged against a weekly price (units must not be mixed)", async () => {
    // Real content: "Motorbike rental (125cc)" has per_day (Patong 200–350) and per_week (Phuket 1200–2000) rows.
    vi.stubEnv("SAMPLE_DATA_DIR", "content");
    resetSampleCache();
    try {
      const t = await text(await post({ item: "Motorbike rental (125cc)", quoted: 1500, area: "Patong", lang: "en" }));
      expect(t.split("\n")[0]).not.toBe("Verdict: Within normal range");
    } finally {
      vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/content");
      resetSampleCache();
    }
  });

  describe("validation (400 bad_request, contract error shape)", () => {
    it.each([
      ["invalid JSON", "{nope"],
      ["missing item", { quoted: 1, lang: "en" }],
      ["empty item", { item: "  ", quoted: 1, lang: "en" }],
      ["item too long", { item: "a".repeat(201), quoted: 1, lang: "en" }],
      ["negative quote", { item: "x", quoted: -5, lang: "en" }],
      ["zero quote", { item: "x", quoted: 0, lang: "en" }],
      ["quote as string", { item: "x", quoted: "100", lang: "en" }],
      ["thai UI lang", { item: "x", quoted: 1, lang: "th" }],
      ["missing quoted (must be number|null)", { item: "x", lang: "en" }],
    ])("%s", async (_n, body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      const j = (await res.json()) as ApiError;
      expect(j.error.code).toBe("bad_request");
    });

    it("accepts quoted: null", async () => {
      expect((await post({ item: "jetski_30min", quoted: null, lang: "en" })).status).toBe(200);
    });
  });

  describe("failures", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/content");
      resetSampleCache();
    });

    it("missing API key in a real provider ⇒ 503 unavailable before streaming", async () => {
      vi.stubEnv("AI_PROVIDER", "anthropic");
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      const res = await post({ item: "jetski_30min", quoted: 1, lang: "en" });
      expect(res.status).toBe(503);
      expect(((await res.json()) as ApiError).error.code).toBe("unavailable");
    });

    it("unknown AI_PROVIDER ⇒ 503", async () => {
      vi.stubEnv("AI_PROVIDER", "llama");
      expect((await post({ item: "jetski_30min", quoted: 1, lang: "en" })).status).toBe(503);
    });

    it("STREAMERROR ⇒ 200 stream ending in ERROR_MARKER", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = await text(await post({ item: "jetski_30min STREAMERROR", quoted: 1, lang: "en" }));
      expect(t.endsWith(ERROR_MARKER)).toBe(true);
      spy.mockRestore();
    });

    it("broken sample data ⇒ 500 internal, no details leaked", async () => {
      vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/does-not-exist");
      resetSampleCache();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await post({ item: "x", quoted: 1, lang: "en" });
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toMatch(/ENOENT|does-not-exist/);
      spy.mockRestore();
    });
  });
});
