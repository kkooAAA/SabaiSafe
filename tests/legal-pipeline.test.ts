// lib/ai/legal.ts pure helpers, lib/ai/answer-guard.ts, lib/ai/legal-index.ts (P2-3, contracts §3.1).
import { describe, expect, it } from "vitest";
import type { LegalMatchRow } from "@/types/db";
import { fallbackRewrite, parseRewrite, selectSources, toLegalSources, toPromptSources, MAX_SOURCES } from "@/lib/ai/legal";
import { guardAnswer, guardNumbers } from "@/lib/ai/answer-guard";
import { matchSample } from "@/lib/ai/legal-index";
import { mockEmbedding } from "@/lib/ai/provider";
import { legalGuideUser } from "@/lib/ai/prompts";
import { inventedNumbers } from "./helpers/phones";

const row = (id: number, over: Partial<LegalMatchRow> = {}): LegalMatchRow => ({
  id,
  doc_slug: `doc-${id}`,
  chunk_index: 0,
  lang: "en",
  title: `Title ${id}`,
  law: "Some Act B.E. 2522",
  law_th: null,
  section: "TO VERIFY",
  location: "Phuket",
  source_url: null,
  topic: "transport",
  status: "DRAFT",
  heading: "Summary",
  content: `Title ${id}\nSummary\n\nBody text ${id}.`,
  similarity: 0.5,
  ...over,
});

describe("parseRewrite / fallbackRewrite", () => {
  it("parses JSON, tolerating fences and prose", () => {
    const j = '{"search_query":"taxi meter","location":"Patong","topic":"transport","is_emergency":false}';
    for (const t of [j, "```json\n" + j + "\n```", `Here you go: ${j} thanks`]) {
      expect(parseRewrite(t)).toEqual({ search_query: "taxi meter", location: "Patong", topic: "transport", is_emergency: false });
    }
  });
  it("unknown topic => other, non-boolean emergency => false, empty location => null", () => {
    expect(parseRewrite('{"search_query":"x","location":"","topic":"nightlife","is_emergency":"yes"}')).toEqual({
      search_query: "x",
      location: null,
      topic: "other",
      is_emergency: false,
    });
  });
  it("null on junk or a missing search_query", () => {
    for (const t of ["", "no json", "{bad}", '{"topic":"price"}', '{"search_query":""}']) expect(parseRewrite(t), t).toBeNull();
  });
  it("fallback searches with the question and still flags emergencies", () => {
    expect(fallbackRewrite("taxi fare")).toEqual({ search_query: "taxi fare", location: null, topic: "other", is_emergency: false });
    expect(fallbackRewrite("I am hurt").is_emergency).toBe(true);
    expect(fallbackRewrite("救命").is_emergency).toBe(true);
  });
});

describe("selectSources", () => {
  it("drops rows under the threshold (inclusive at min) and NaN", () => {
    const out = selectSources([row(1, { similarity: 0.3 }), row(2, { similarity: 0.29 }), row(3, { similarity: Number.NaN })], "en", 0.3);
    expect(out.map((r) => r.id)).toEqual([1]);
  });
  it("orders by similarity, dedupes ids (keeping the best), caps at MAX_SOURCES", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, { similarity: 0.4 + i / 100 }));
    rows.push(row(1, { similarity: 0.99 }));
    const out = selectSources(rows, "en", 0.3);
    expect(out).toHaveLength(MAX_SOURCES);
    expect(out[0]).toMatchObject({ id: 1, similarity: 0.99 });
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
  });
  it("zh: zh rows rank first; an en chunk is dropped when the zh version of that doc is present", () => {
    const rows = [
      row(1, { lang: "en", doc_slug: "taxi", similarity: 0.9 }),
      row(2, { lang: "zh", doc_slug: "taxi", similarity: 0.5 }),
      row(3, { lang: "en", doc_slug: "drones", similarity: 0.8 }),
      row(4, { lang: "zh", doc_slug: "gambling", similarity: 0.4 }),
    ];
    expect(selectSources(rows, "zh", 0.3).map((r) => r.id)).toEqual([2, 4, 3]);
  });
  it("empty in, empty out (=> no-answer path)", () => {
    expect(selectSources([], "en", 0.3)).toEqual([]);
    expect(selectSources([row(1, { similarity: 0.1 })], "zh", 0.3)).toEqual([]);
  });
});

describe("toLegalSources / toPromptSources", () => {
  it("ids are 1..n citation numbers; status, section, slug passed through; excerpt <= 300 without the prefix", () => {
    const long = row(7, { content: `T\nH\n\n${"word ".repeat(200)}`, status: "DRAFT", similarity: 0.123456 });
    const s = toLegalSources([row(5, { status: "VERIFIED", section: "Section 4" }), long]);
    expect(s.map((x) => x.id)).toEqual([1, 2]);
    expect(s[0]).toMatchObject({ chunk_id: 5, doc_slug: "doc-5", status: "VERIFIED", section: "Section 4", excerpt: "Body text 5." });
    expect(s[1]).toMatchObject({ chunk_id: 7, status: "DRAFT", section: "TO VERIFY", similarity: 0.123 });
    expect(Array.from(s[1]!.excerpt).length).toBeLessThanOrEqual(300);
  });
  it("a TO VERIFY section is never shown to the model as a section number", () => {
    const prompt = legalGuideUser("q", toPromptSources([row(1), row(2, { section: "Section 4", source_url: "https://x.example" })]));
    expect(prompt).not.toMatch(/section TO VERIFY/i);
    expect(prompt).toContain("[2] Title 2 — Some Act B.E. 2522, section Section 4 (https://x.example)");
    expect(prompt).toContain("[1] Title 1 — Some Act B.E. 2522\n");
  });
});

describe("guardNumbers / guardAnswer", () => {
  it("redacts phone-shaped numbers and non-hotline short codes after a call word", () => {
    for (const t of ["Call 081 234 5678 now.", "Ring +66 76 211 036.", "拨打 13812345678", "Call the office on 1199.", "请拨打电话 2345。"]) {
      const g = guardNumbers(t);
      expect(inventedNumbers(g), t).toEqual([]);
      expect(g, t).toContain("[REDACTED]");
    }
  });
  it("keeps hotlines, amounts, durations, years and law names", () => {
    for (const t of [
      "Call Tourist Police 1155, police 191, ambulance 1669 or OCPB 1166.",
      "拨打 1155 或 1669。",
      "Land Transport Act B.E. 2522 (1979).",
      "Call before paying 500 baht.",
      "Call within 24 hours.",
    ]) {
      expect(guardNumbers(t), t).toBe(t);
    }
  });
  it("is idempotent", () => {
    const t = "Call 081 234 5678 or 1155.";
    expect(guardNumbers(guardNumbers(t))).toBe(guardNumbers(t));
  });

  async function collect(chunks: string[], disclaimer?: string) {
    async function* gen() {
      for (const c of chunks) yield c;
    }
    let out = "";
    for await (const d of guardAnswer(gen(), disclaimer)) out += d;
    return out;
  }

  it("catches a phone number split across chunks", async () => {
    const out = await collect(["Please call 08", "1 23", "4 5678 for help. ", "x".repeat(100)]);
    expect(out).toContain("[REDACTED]");
    expect(inventedNumbers(out)).toEqual([]);
  });
  it("catches a short code whose call word is in an earlier chunk", async () => {
    const out = await collect(["Please dial the hotline ", "x ".repeat(3), "2", "345 now. ", "y".repeat(120)]);
    expect(out).not.toContain("2345");
  });
  it("passes text through unchanged otherwise (any chunking)", async () => {
    const text = "Taxis must use the meter [1]. 出租车必须打表 [2]。Call 1155. 😀 done";
    for (const size of [1, 2, 3, 7, 64, 1000]) {
      const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "gu")) ?? [];
      expect(await collect(chunks), `size ${size}`).toBe(text);
    }
  });
  it("on a mid-stream error, flushes the held-back text (guarded) and rethrows", async () => {
    async function* failing() {
      yield "Answer part, call 081 234 ";
      yield "5678";
      throw new Error("model died");
    }
    let out = "";
    await expect(
      (async () => {
        for await (const d of guardAnswer(failing(), "ZZ-DISCLAIMER")) out += d;
      })(),
    ).rejects.toThrow("model died");
    expect(out).toContain("Answer part");
    expect(inventedNumbers(out)).toEqual([]);
    expect(out).not.toContain("ZZ-DISCLAIMER"); // no disclaimer appended after an error (ERROR_MARKER follows)
  });

  it("appends the disclaimer only when missing", async () => {
    const d = "This is general information.";
    expect(await collect(["Answer."], d)).toBe(`Answer.\n\n${d}`);
    expect(await collect(["Answer.\n"], d)).toBe(`Answer.\n\n${d}`);
    expect(await collect([`Answer.\n\n${d.slice(0, 5)}`, d.slice(5)], d)).toBe(`Answer.\n\n${d}`);
    expect(await collect([], d)).toBe(d);
  });
});

describe("matchSample (in-memory index over content/legal, mock embeddings)", () => {
  it("honours the lang filter, the cap of 20, and sorts by similarity", async () => {
    const en = await matchSample(mockEmbedding("taxi meter fare"), 50, "en");
    expect(en.length).toBe(20);
    expect(en.every((r) => r.lang === "en")).toBe(true);
    for (let i = 1; i < en.length; i++) expect(en[i - 1]!.similarity).toBeGreaterThanOrEqual(en[i]!.similarity);
    const all = await matchSample(mockEmbedding("taxi"), 20, null);
    expect(new Set(all.map((r) => r.lang)).size).toBeGreaterThanOrEqual(1);
    expect((await matchSample(mockEmbedding("taxi"), 0, "zh")).length).toBe(1);
  });
  it("finds the right topic lexically and passes DRAFT through", async () => {
    const [top] = await matchSample(mockEmbedding("taxi tuk-tuk meter fare"), 6, "en");
    expect(top?.doc_slug).toBe("taxi-tuk-tuk-fares");
    expect(top?.status).toBe("DRAFT");
    const [zh] = await matchSample(mockEmbedding("出租车 打表 车费"), 6, "zh");
    expect(zh?.doc_slug).toBe("taxi-tuk-tuk-fares");
  });
});
