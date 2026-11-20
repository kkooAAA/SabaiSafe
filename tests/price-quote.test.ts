// frontend components/price/quote.ts: parsing the "I was quoted X" field, unit list, verdict message keys.
import { describe, expect, it } from "vitest";
import { MAX_QUOTED, VERDICT_KEY, looksLikeOtherCurrency, parseQuoted, unitsOf } from "@/components/price/quote";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { PRICE_UNITS, PriceExplainRequest, type PriceRef } from "@/types/api";
import { selectRefs, type PriceVerdict } from "@/types/price-verdict";

const row = (unit: PriceRef["unit"]): PriceRef => ({
  id: unit, item_key: "k", item_name_en: "K", item_name_zh: "钾", category: "rental", area: "Phuket", min_thb: 1, max_thb: 2,
  unit, is_fixed_by_law: false, source: "SAMPLE DATA", source_url: null, collected_at: "2026-11-01", notes: null, notes_zh: null,
  is_sample: true,
});

describe("parseQuoted", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["1200", 1200],
    ["1,200", 1200],
    ["1 200.50", 1200.5],
    ["฿1,500", 1500],
    ["1500 THB", 1500],
    ["1500thb", 1500],
    ["0.5", 0.5],
    [String(MAX_QUOTED), MAX_QUOTED],
  ] as const)("%j ⇒ %j", (input, want) => expect(parseQuoted(input)).toBe(want));

  // 元 / RMB / CNY / ¥ is Chinese yuan (~5x a baht): silently reading it as THB would understate the quote.
  it.each(["1200元", "1200 RMB", "¥1200", "1200 CNY", "$40"])("%j (another currency) ⇒ invalid", (input) =>
    expect(parseQuoted(input)).toBe("invalid"),
  );

  it.each(["0", "-5", "abc", "12a", "1e5", "1..2", String(MAX_QUOTED + 1), "Infinity", "NaN", "0x10"])("%j ⇒ invalid", (input) =>
    expect(parseQuoted(input)).toBe("invalid"),
  );

  it("every valid result passes the API schema", () => {
    for (const s of ["", "1200", "1,200", "1 200.50", "฿1,500"]) {
      const quoted = parseQuoted(s);
      expect(quoted).not.toBe("invalid");
      expect(PriceExplainRequest.safeParse({ item: "x", quoted, lang: "en" }).success, s).toBe(true);
    }
  });

  // Chinese and Thai users type these. They should parse, not be rejected as invalid.
  it.each([
    ["１２００", 1200], // full-width digits (Chinese IME)
    ["１，２００", 1200], // full-width comma
    ["1200泰铢", 1200],
    ["1200铢", 1200],
    ["1200 baht", 1200],
    ["1200 บาท", 1200],
  ] as const)("accepts %j ⇒ %d", (input, want) => expect(parseQuoted(input)).toBe(want));
});

describe("looksLikeOtherCurrency (hint: enter the price in Thai baht)", () => {
  it.each(["1200元", "￥1200", "¥1200", "1200 RMB", "1200 cny", "$40", "40 USD", "€35", "£30", "35 EUR", "1200 yuan", "1200人民币", "40美元"])(
    "%j ⇒ true, and is never converted",
    (s) => {
      expect(looksLikeOtherCurrency(s)).toBe(true);
      expect(parseQuoted(s)).toBe("invalid");
    },
  );
  it.each(["1200", "฿1,200", "1200 THB", "1200 baht", "1200 บาท", "1200泰铢", "１２００", ""])("%j ⇒ false", (s) =>
    expect(looksLikeOtherCurrency(s)).toBe(false),
  );
  it.each([["en", en], ["zh", zh]] as const)("has a %s hint message (price.check.otherCurrency)", (_l, m) => {
    const hint = (m as { price?: { check?: { otherCurrency?: string } } }).price?.check?.otherCurrency;
    expect(hint).toBeTruthy();
  });
});

describe("unitsOf", () => {
  it("lists present units in PRICE_UNITS order, deduped", () => {
    expect(unitsOf([row("per_week"), row("per_day"), row("per_week")])).toEqual(["per_day", "per_week"]);
    expect(unitsOf([])).toEqual([]);
  });
  it("its first unit is the one selectRefs picks by default (badge and AI agree)", () => {
    const rows = [row("per_week"), row("per_hour"), row("per_day")];
    expect(selectRefs(rows)[0]?.unit).toBe(unitsOf(rows)[0]);
  });
});

describe("VERDICT_KEY", () => {
  const all: PriceVerdict[] = ["Within normal range", "Above typical range", "Far above typical range", "No price quoted", "Not enough data"];
  it("covers every verdict with a unique key", () => {
    expect(Object.keys(VERDICT_KEY).sort()).toEqual([...all].sort());
    expect(new Set(Object.values(VERDICT_KEY)).size).toBe(all.length);
  });
  it.each([["en", en], ["zh", zh]] as const)("every key has a %s message (price.verdict.<key>)", (_l, m) => {
    const verdict = (m as { price?: { verdict?: Record<string, string> } }).price?.verdict ?? {};
    for (const k of Object.values(VERDICT_KEY)) expect(verdict[k], k).toBeTruthy();
  });
  it.each([["en", en], ["zh", zh]] as const)("every unit has a %s label (price.unit.<key>)", (_l, m) => {
    const unit = (m as { price?: { unit?: Record<string, string> } }).price?.unit ?? {};
    for (const u of PRICE_UNITS) expect(unit[u], u).toBeTruthy();
  });
});
