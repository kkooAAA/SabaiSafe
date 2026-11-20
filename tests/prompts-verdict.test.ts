// Approved prompts.ts edits, the shared verdict rule (types/price-verdict.ts), and badge/AI parity.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DISCLAIMER, NO_ANSWER_MESSAGE } from "@/lib/ai/constants";
import { MODEL_DEFAULTS } from "@/lib/ai/provider";
import { fairPriceSystem, fairPriceUser, legalGuideSystem, legalGuideUser } from "@/lib/ai/prompts";
import { findPrices } from "@/lib/db/prices";
import { resetSampleCache } from "@/lib/db/sample";
import { POST } from "@/app/api/chat/price/route";
import { HOTLINE_NUMBERS } from "@/lib/hotlines";
import { computeVerdict, selectRefs, verdictFor } from "@/types/price-verdict";
import type { PriceRef } from "@/types/api";
import { findPhoneLike } from "./helpers/phones";

describe("prompts.ts (approved edits)", () => {
  it("legal prompts embed the fixed disclaimer verbatim, per language", () => {
    expect(legalGuideSystem("en")).toContain(DISCLAIMER.en);
    expect(legalGuideSystem("zh")).toContain(DISCLAIMER.zh);
    expect(DISCLAIMER.zh).toMatch(/[一-鿿]/);
    expect(DISCLAIMER.en).toContain("1155");
    expect(DISCLAIMER.zh).toContain("1155");
  });

  it("no-answer messages point to 1155 and include the disclaimer", () => {
    for (const l of ["en", "zh"] as const) {
      expect(NO_ANSWER_MESSAGE[l]).toContain("1155");
      expect(NO_ANSWER_MESSAGE[l]).toContain(DISCLAIMER[l]);
    }
  });

  it("fairPriceUser marks legally fixed refs and nothing else", () => {
    const ref = { item: "Taxi", area: "Phuket", min: 1, max: 2, unit: "per_trip", source: "S", collected_at: "2026-10-01" };
    expect(fairPriceUser("taxi", 5, [{ ...ref, is_fixed_by_law: true }])).toContain("LEGALLY FIXED PRICE");
    expect(fairPriceUser("taxi", 5, [{ ...ref, is_fixed_by_law: false }])).not.toContain("LEGALLY FIXED PRICE");
    expect(fairPriceUser("taxi", null, [])).toMatch(/none found/);
  });

  it("the fair-price prompt contains no example prices the model could parrot", () => {
    for (const l of ["en", "zh"] as const) expect(fairPriceSystem(l)).not.toMatch(/\d{3,}\s*[–-]\s*\d{3,}\s*THB/);
  });

  it("legalGuideUser omits a TO VERIFY section", () => {
    const u = legalGuideUser("q", [{ id: 1, title: "T", law: "L", section: "TO VERIFY", content: "c" }]);
    expect(u).not.toMatch(/section TO VERIFY/);
  });

  it("system prompts mention only hotline numbers", () => {
    const all = [legalGuideSystem("en"), legalGuideSystem("zh"), fairPriceSystem("en"), fairPriceSystem("zh")].join("\n");
    expect(findPhoneLike(all)).toEqual([]);
    // Short codes like 1155; skip word limits such as "under 120 words" / "120 字".
    const shortCodes = [...all.matchAll(/\b1\d{2,3}\b(?!\s*(words|word|字|characters))/g)].map((m) => m[0]);
    for (const c of shortCodes) expect(HOTLINE_NUMBERS as readonly string[], c).toContain(c);
  });

  it("has model defaults for both real providers", () => {
    expect(MODEL_DEFAULTS.anthropic.chat).toMatch(/^claude-/);
    expect(MODEL_DEFAULTS.openai.fast).toBeTruthy();
  });
});

const ref = (over: Partial<PriceRef>): PriceRef => ({
  id: Math.random().toString(36), item_key: "m", item_name_en: "M", item_name_zh: "摩", category: "rental", area: "Patong",
  min_thb: 200, max_thb: 350, unit: "per_day", is_fixed_by_law: false, source: "SAMPLE DATA", source_url: null,
  collected_at: "2026-11-01", notes: null, notes_zh: null, is_sample: true, ...over,
});

describe("selectRefs / verdictFor (one unit, local rows first)", () => {
  const day = ref({});
  const dayTown = ref({ area: "Phuket Town", max_thb: 300 });
  const weekIsland = ref({ area: "Phuket", unit: "per_week", max_thb: 2000 });

  it("never mixes units", () => {
    for (const area of [null, "Patong", "Kata"]) {
      const units = new Set(selectRefs([weekIsland, day, dayTown], area).map((r) => r.unit));
      expect(units.size, String(area)).toBeLessThanOrEqual(1);
    }
  });

  it("prefers rows for the given area over island-wide rows", () => {
    expect(selectRefs([weekIsland, day, dayTown], "Patong")).toEqual([day]);
  });

  it("falls back to island-wide rows when the area has none", () => {
    expect(selectRefs([weekIsland], "Kata")).toEqual([weekIsland]);
  });

  it("an explicit unit filters first; unknown unit ⇒ Not enough data", () => {
    expect(selectRefs([weekIsland, day], null, "per_week")).toEqual([weekIsland]);
    expect(verdictFor([day], 100, null, "per_hour")).toBe("Not enough data");
  });

  it("is independent of row order", () => {
    expect(verdictFor([weekIsland, day, dayTown], 1500, null)).toBe(verdictFor([dayTown, day, weekIsland], 1500, null));
  });

  it("a 1500 THB daily quote in Patong is far above", () => {
    expect(verdictFor([weekIsland, day, dayTown], 1500, "Patong")).toBe("Far above typical range");
  });

  it("computeVerdict boundaries", () => {
    expect(computeVerdict(350, [350])).toBe("Within normal range");
    expect(computeVerdict(525, [350])).toBe("Above typical range");
    expect(computeVerdict(526, [350])).toBe("Far above typical range");
  });
});

describe("unit handling on real content (Motorbike rental (125cc))", () => {
  beforeAll(() => {
    vi.stubEnv("SAMPLE_DATA_DIR", "content");
    resetSampleCache();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    resetSampleCache();
  });
  const ITEM = "Motorbike rental (125cc)";
  const ask = async (body: Record<string, unknown>) =>
    POST(new Request("http://localhost/api/chat/price", { method: "POST", body: JSON.stringify({ item: ITEM, lang: "en", ...body }) }));
  const firstLine = async (body: Record<string, unknown>) => (await (await ask(body)).text()).split("\n")[0];

  it("no unit/area keeps per_day by PRICE_UNITS order, not row order", async () => {
    const rows = await findPrices({ item: ITEM });
    expect(new Set(rows.map((r) => r.unit))).toEqual(new Set(["per_day", "per_week"]));
    expect(selectRefs(rows).every((r) => r.unit === "per_day")).toBe(true);
    expect(selectRefs([...rows].reverse()).map((r) => r.id).sort()).toEqual(selectRefs(rows).map((r) => r.id).sort());
    expect(await firstLine({ quoted: 1500 })).toBe("Verdict: Far above typical range");
  });

  it.each([
    [{ unit: "per_week", quoted: 1500 }, "Within normal range"],
    [{ unit: "per_week", area: "Patong", quoted: 1500 }, "Within normal range"], // falls back to island-wide weekly row
    [{ unit: "per_hour", quoted: 1500 }, "Not enough data"],
    [{ quoted: null }, "No price quoted"],
  ])("%j ⇒ %s", async (body, verdict) => expect(await firstLine(body)).toBe(`Verdict: ${verdict}`));

  it.each(["en", "zh"])("answer shows a readable unit, never a raw per_* key (%s)", async (lang) => {
    const t = await (await ask({ quoted: 1500, lang })).text();
    expect(t).not.toMatch(/per_[a-z0-9]+/);
    expect(t).toMatch(lang === "en" ? /per day/ : /每天/);
  });

  it("No price quoted still shows the typical range", async () => {
    expect(await (await ask({ quoted: null })).text()).toContain("Typical: ");
  });

  it("unknown unit ⇒ 400 bad_request", async () => {
    const res = await ask({ unit: "per_fortnight", quoted: 1 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
  });

  it("fairPriceUser passes the computed verdict only when given", () => {
    const r = [{ item: "M", area: "Patong", min: 200, max: 350, unit: "per_day", source: "S", collected_at: "2026-11-01", is_fixed_by_law: false }];
    expect(fairPriceUser("M", 1500, r, "Far above typical range")).toContain("COMPUTED VERDICT: Far above typical range");
    expect(fairPriceUser("M", 1500, r)).not.toContain("COMPUTED VERDICT");
  });
});

describe("UI badge and AI agree (verdictFor vs /api/chat/price first line, real content)", () => {
  beforeAll(() => {
    vi.stubEnv("SAMPLE_DATA_DIR", "content");
    resetSampleCache();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    resetSampleCache();
  });

  const cases: [string, string | null, number][] = [
    ["Motorbike rental (125cc)", "Patong", 1500],
    ["Motorbike rental (125cc)", "Phuket Town", 280],
    ["motorbike_rental_125cc_week", null, 2500],
    ["jetski_30min", "Kata", 1600],
    ["jetski_30min", "Kata", 3000],
    ["Tuk-tuk", "Patong", 450],
    ["taxi_airport_patong", "Phuket Airport", 900],
    ["no such thing", null, 100],
  ];

  it.each(cases)("%s @ %s, quoted %d", async (item, area, quoted) => {
    const badge = verdictFor(await findPrices({ item, area }), quoted, area);
    const res = await POST(
      new Request("http://localhost/api/chat/price", { method: "POST", body: JSON.stringify({ item, quoted, area, lang: "en" }) }),
    );
    const first = (await res.text()).split("\n")[0];
    expect(first).toBe(`Verdict: ${badge}`);
  });
});
