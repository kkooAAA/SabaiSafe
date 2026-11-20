// frontend pure helpers: merge-contacts, price picker, shared format.
import { describe, expect, it } from "vitest";
import { filterByCategory, isHotlineNumber, mergeContacts } from "@/components/help/merge-contacts";
import { buildAreas, buildItemGroups, filterPrices } from "@/components/price/picker";
import { formatThbRange, pickLang, safeUrl, telHref } from "@/components/shared/format";
import { HOTLINES } from "@/lib/hotlines";
import type { HelpContact, PriceRef } from "@/types/api";

const contact = (over: Partial<HelpContact>): HelpContact => ({
  id: Math.random().toString(36),
  category: "police",
  name_en: "X",
  name_zh: null,
  name_th: null,
  phone: null,
  address: null,
  area: null,
  google_maps_url: null,
  website: null,
  hours: null,
  languages: [],
  source_url: null,
  sort_order: 0,
  verified: false,
  is_sample: true,
  ...over,
});

const price = (over: Partial<PriceRef>): PriceRef => ({
  id: Math.random().toString(36),
  item_key: "k",
  item_name_en: "K",
  item_name_zh: "钾",
  category: "transport",
  area: "Patong",
  min_thb: 1,
  max_thb: 2,
  unit: "per_trip",
  is_fixed_by_law: false,
  source: "SAMPLE DATA",
  source_url: null,
  collected_at: "2026-11-01",
  notes: null,
  notes_zh: null,
  is_sample: true,
  ...over,
});

describe("mergeContacts", () => {
  it.each([null, undefined, []])("returns the four hotlines for %j (DB failed / empty)", (input) => {
    const r = mergeContacts(input);
    expect(r.hotlines.map((h) => h.number)).toEqual(HOTLINES.map((h) => h.number));
    expect(r.contacts).toEqual([]);
    expect(r.categories).toEqual([]);
  });

  it("drops DB rows that duplicate a hotline, in any format", () => {
    const r = mergeContacts([
      contact({ phone: "1155", category: "emergency" }),
      contact({ phone: " 1-6-6-9 " }),
      contact({ phone: "+66 76 000 000", name_en: "Keep" }),
      contact({ phone: null, name_en: "Keep2", category: "hospital" }),
    ]);
    expect(r.contacts.map((c) => c.name_en)).toEqual(["Keep", "Keep2"]);
    expect(r.categories).toEqual(["police", "hospital"]);
  });

  it("isHotlineNumber", () => {
    expect(isHotlineNumber("191")).toBe(true);
    expect(isHotlineNumber("1911")).toBe(false);
    expect(isHotlineNumber(null)).toBe(false);
  });

  it("filterByCategory(null) returns a copy", () => {
    const list = [contact({}), contact({ category: "hospital" })];
    const all = filterByCategory(list, null);
    expect(all).toEqual(list);
    expect(all).not.toBe(list);
    expect(filterByCategory(list, "hospital")).toHaveLength(1);
  });
});

describe("price picker", () => {
  const rows = [
    price({ item_key: "tuk", item_name_en: "Tuk-tuk", item_name_zh: "嘟嘟车", area: "Patong" }),
    price({ item_key: "tuk", item_name_en: "Tuk-tuk", item_name_zh: "嘟嘟车", area: "Kata" }),
    price({ item_key: "taxi", item_name_en: "Airport taxi", item_name_zh: "机场出租车", area: "Phuket Airport" }),
    price({ item_key: "water", item_name_en: "Water", item_name_zh: "", category: "food", area: "Phuket" }),
  ];

  it("groups distinct items by category in fixed order, sorted by label", () => {
    const g = buildItemGroups(rows, "en");
    expect(g.map((x) => x.category)).toEqual(["transport", "food"]);
    expect(g[0]?.items.map((i) => i.label)).toEqual(["Airport taxi", "Tuk-tuk"]);
  });

  it("uses zh labels, falling back to English when zh is empty", () => {
    const g = buildItemGroups(rows, "zh");
    expect(g.flatMap((x) => x.items.map((i) => i.label))).toEqual(expect.arrayContaining(["嘟嘟车", "机场出租车", "Water"]));
  });

  it("lists areas with island-wide first", () => {
    expect(buildAreas(rows)).toEqual(["Phuket", "Kata", "Patong", "Phuket Airport"]);
  });

  it("filters by item/area and always includes island-wide rows", () => {
    expect(filterPrices(rows, null, null)).toHaveLength(4);
    expect(filterPrices(rows, "tuk", "Kata").map((r) => r.area)).toEqual(["Kata"]);
    expect(filterPrices(rows, null, "Kata").map((r) => r.area)).toEqual(["Kata", "Phuket"]);
  });
});

describe("format helpers", () => {
  it.each([
    ["1155", "tel:1155"],
    ["+66 76 123 456", "tel:+6676123456"],
    [" 076-123-456 ", "tel:076123456"],
  ])("telHref(%j) = %s", (p, want) => expect(telHref(p)).toBe(want));

  it("pickLang falls back to English", () => {
    expect(pickLang("zh", "Hi", "你好")).toBe("你好");
    expect(pickLang("zh", "Hi", null)).toBe("Hi");
    expect(pickLang("zh", "Hi", "  ")).toBe("Hi");
    expect(pickLang("en", "Hi", "你好")).toBe("Hi");
  });

  it("formatThbRange", () => {
    expect(formatThbRange(1200, 1200, "en")).toBe("฿1,200");
    expect(formatThbRange(300, 1500, "en")).toBe("฿300–1,500");
    expect(formatThbRange(99.5, 100, "zh")).toBe("฿99.5–100");
  });

  it.each([
    ["https://example.org/a", "https://example.org/a"],
    ["http://example.org", "http://example.org/"],
    ["javascript:alert(1)", null],
    ["data:text/html,x", null],
    ["not a url", null],
    [null, null],
  ])("safeUrl(%j) = %j", (u, want) => expect(safeUrl(u)).toBe(want));
});
