// backend lib/db in sample mode (no Supabase): loader validation, price/help query rules, reports store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSampleData, loadSampleData, parseHelpJson, parsePricesCsv, resetSampleCache } from "@/lib/db/sample";
import { filterHelp, filterPrices, MAX_PRICE_ROWS } from "@/lib/db/query";
import { findPrices } from "@/lib/db/prices";
import { getHelp } from "@/lib/db/help";
import { isSampleMode } from "@/lib/db/client";
import { SampleDataError } from "@/lib/db/errors";
import { deleteReport, getReport, memoryReportCount, resetMemoryReports, saveReport } from "@/lib/db/reports";
import { HOTLINE_NUMBERS } from "@/lib/hotlines";
import { CONSENT_VERSION, type PriceRef, type ReportFacts } from "@/types/api";

const FIX = join(process.cwd(), "tests", "fixtures", "content");
const fixCsv = readFileSync(join(FIX, "prices.csv"), "utf8");
const fixHelp = JSON.parse(readFileSync(join(FIX, "help.json"), "utf8")) as { contacts: Record<string, unknown>[]; businesses: Record<string, unknown>[] };
const HEADER = fixCsv.split("\n")[0] ?? "";
const GOOD_ROW = "x_item,X item,某物,other,Patong,10,20,per_item,false,SAMPLE DATA,,2026-11-01,,,true";

function csvWith(row: string) {
  return `${HEADER}\n${row}\n`;
}

function expectSampleError(fn: () => unknown, where: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SampleDataError);
    expect((e as SampleDataError).where).toMatch(where);
    return;
  }
  throw new Error("expected SampleDataError");
}

const clone = <T,>(v: T): T => structuredClone(v);

describe("sample mode switch", () => {
  it("is on with an empty NEXT_PUBLIC_SUPABASE_URL (vitest env)", () => expect(isSampleMode()).toBe(true));
});

describe("parsePricesCsv validation", () => {
  it("accepts the fixture", () => expect(parsePricesCsv(fixCsv)).toHaveLength(6));
  it("accepts a quoted note containing a comma", () => {
    expect(parsePricesCsv(fixCsv)[0]?.notes).toBe("Agree the price first, then ride.");
  });
  it("accepts a UTF-8 BOM and CRLF", () => {
    expect(parsePricesCsv(`﻿${HEADER}\r\n${GOOD_ROW}\r\n`)).toHaveLength(1);
  });

  it("rejects a wrong header", () => expectSampleError(() => parsePricesCsv(`a,b\n1,2\n`), /^prices\.csv:1$/));
  it.each([
    ["min > max", GOOD_ROW.replace(",10,20,", ",30,20,")],
    ["unit not in PRICE_UNITS", GOOD_ROW.replace("per_item", "per item")],
    ["bad category", GOOD_ROW.replace(",other,", ",misc,")],
    ["area outside the fixed list", GOOD_ROW.replace(",Patong,", ",Bangkok,")],
    ["impossible date", GOOD_ROW.replace("2026-11-01", "2026-02-30")],
    ["bad boolean", GOOD_ROW.replace(/,true$/, ",yes")],
    ["number with comma/currency", GOOD_ROW.replace(",10,20,", ',"1,000",2000,')],
    ["empty required column", GOOD_ROW.replace("X item", "")],
    ["SAMPLE DATA but is_sample=false", GOOD_ROW.replace(/,true$/, ",false")],
    ["SAMPLE DATA but fixed by law", GOOD_ROW.replace(",per_item,false,", ",per_item,true,")],
    ["missing column", GOOD_ROW.replace(/,true$/, "")],
    ["non-snake item_key", GOOD_ROW.replace("x_item", "X-Item")],
  ])("rejects %s with the line number", (_name, row) => expectSampleError(() => parsePricesCsv(csvWith(row)), /^prices\.csv:2$/));

  it("rejects a duplicate (item_key, area, source, collected_at) and reports the later line", () =>
    expectSampleError(() => parsePricesCsv(`${HEADER}\n${GOOD_ROW}\n${GOOD_ROW}\n`), /^prices\.csv:3$/));

  it("a fixed-by-law price needs an official source_url", () => {
    const row = GOOD_ROW.replace(",per_item,false,SAMPLE DATA,,", ",per_item,true,Land Transport Office,,").replace(/,true$/, ",false");
    expectSampleError(() => parsePricesCsv(csvWith(row)), /^prices\.csv:2$/);
  });
});

describe("parseHelpJson validation", () => {
  it("accepts the fixture", () => {
    const r = parseHelpJson(fixHelp);
    expect(r.contacts).toHaveLength(3);
    expect(r.businesses).toHaveLength(4);
  });

  it("rejects a wrong top-level shape", () => expectSampleError(() => parseHelpJson({ contacts: [] }), /^help\.json$/));

  it.each(HOTLINE_NUMBERS.map((n) => [n]))("rejects hotline %s inside help.json", (n) => {
    const j = clone(fixHelp);
    Object.assign(j.contacts[2]!, { phone: n });
    expectSampleError(() => parseHelpJson(j), /contacts\[2\]/);
  });

  it("rejects a contact phone without source_url", () => {
    const j = clone(fixHelp);
    Object.assign(j.contacts[2]!, { source_url: null, verified: false });
    expectSampleError(() => parseHelpJson(j), /contacts\[2\]/);
  });

  it("rejects a contact phone that is not verified (contracts v0.2: phone ⇒ verified AND source_url)", () => {
    const j = clone(fixHelp);
    Object.assign(j.contacts[2]!, { verified: false });
    expectSampleError(() => parseHelpJson(j), /contacts\[2\]/);
  });

  it("rejects a badly formatted phone", () => {
    const j = clone(fixHelp);
    Object.assign(j.contacts[2]!, { phone: "076-000-000" });
    expectSampleError(() => parseHelpJson(j), /contacts\[2\]/);
  });

  it("rejects a business phone without source_url + verified_at", () => {
    const j = clone(fixHelp);
    Object.assign(j.businesses[0]!, { is_sample: false, name: "Real Co", phone: "+66 76 000 001", source_url: "https://example.org" });
    expectSampleError(() => parseHelpJson(j), /businesses\[0\]/);
  });

  it("rejects a sample business without the [SAMPLE] prefix, or with a phone/link", () => {
    for (const patch of [{ name: "Zulu Rentals" }, { phone: "+66 76 000 001", source_url: "https://x.org", verified_at: "2026-11-01" }, { website: "https://x.org" }]) {
      const j = clone(fixHelp);
      Object.assign(j.businesses[0]!, patch);
      expectSampleError(() => parseHelpJson(j), /businesses\[0\]/);
    }
  });

  it("rejects unknown criteria keys and unknown fields", () => {
    for (const patch of [{ criteria_met: ["cheap"] }, { rating: 5 }]) {
      const j = clone(fixHelp);
      Object.assign(j.businesses[0]!, patch);
      expectSampleError(() => parseHelpJson(j), /businesses\[0\]/);
    }
  });
});

describe("loadSampleData", () => {
  const data = loadSampleData(fixCsv, fixHelp);

  it("adds the four hotlines from lib/hotlines.ts as verified, non-sample contacts", () => {
    const hot = data.contacts.filter((c) => c.phone && (HOTLINE_NUMBERS as readonly string[]).includes(c.phone));
    expect(hot.map((c) => c.phone).sort()).toEqual([...HOTLINE_NUMBERS].sort());
    for (const h of hot) {
      expect(h.verified).toBe(true);
      expect(h.is_sample).toBe(false);
    }
  });

  it("gives stable, unique, UUID-shaped ids", () => {
    const again = loadSampleData(fixCsv, fixHelp);
    const ids = [...data.prices, ...data.contacts, ...data.businesses].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(again.prices.map((p) => p.id)).toEqual(data.prices.map((p) => p.id));
  });

  it("loads the real content/ files without errors", () => {
    resetSampleCache();
    const real = getSampleData();
    expect(real.prices.length).toBeGreaterThanOrEqual(25);
  });
});

describe("filterPrices (§3.6)", () => {
  const rows = loadSampleData(fixCsv, fixHelp).prices;
  const keys = (r: PriceRef[]) => r.map((x) => `${x.item_key}@${x.area}`);

  it("no params ⇒ all rows ordered by category, item_name_en, area", () => {
    expect(keys(filterPrices(rows, {}))).toEqual([
      "jetski_30min@Patong",
      "water_bottle@Phuket",
      "motorbike_day@Phuket Town",
      "taxi_meter_flagfall@Phuket",
      "tuktuk_short@Kata",
      "tuktuk_short@Patong",
    ]);
  });

  it("item matches item_key exactly", () => expect(keys(filterPrices(rows, { item: "jetski_30min" }))).toEqual(["jetski_30min@Patong"]));
  it("item matches the English name case-insensitively (substring)", () =>
    expect(keys(filterPrices(rows, { item: "TUK-TUK" }))).toEqual(["tuktuk_short@Kata", "tuktuk_short@Patong"]));
  it("item matches the Chinese name (substring)", () => expect(keys(filterPrices(rows, { item: "水上摩托" }))).toEqual(["jetski_30min@Patong"]));
  it("item that matches nothing ⇒ []", () => expect(filterPrices(rows, { item: "helicopter" })).toEqual([]));

  it("area matches case-insensitively and always includes island-wide rows", () =>
    expect(keys(filterPrices(rows, { area: "kata" }))).toEqual(["water_bottle@Phuket", "taxi_meter_flagfall@Phuket", "tuktuk_short@Kata"]));

  it("area = Phuket never returns a row twice", () => {
    const r = filterPrices(rows, { area: "Phuket" });
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length);
  });

  it("item + area combine", () => expect(keys(filterPrices(rows, { item: "tuktuk_short", area: "Patong" }))).toEqual(["tuktuk_short@Patong"]));

  it("whitespace-only params mean no filter", () => expect(filterPrices(rows, { item: "  ", area: " " })).toHaveLength(6));

  it(`caps at ${MAX_PRICE_ROWS} rows`, () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...rows[0]!, id: `id${i}`, area: `A${String(i).padStart(3, "0")}` }));
    expect(filterPrices(many, {})).toHaveLength(100);
  });

  it("does not mutate the input", () => {
    const copy = rows.map((r) => r.id);
    filterPrices(rows, { area: "kata" });
    expect(rows.map((r) => r.id)).toEqual(copy);
  });
});

describe("filterHelp (§3.8, §2.4)", () => {
  const data = loadSampleData(fixCsv, fixHelp);

  it("always includes the four hotlines, even from an empty contact list", () => {
    const r = filterHelp([], []);
    expect(r.contacts.map((c) => c.phone).sort()).toEqual([...HOTLINE_NUMBERS].sort());
  });

  it("never duplicates a hotline that is already present", () => {
    const r = filterHelp(data.contacts, data.businesses);
    for (const n of HOTLINE_NUMBERS) expect(r.contacts.filter((c) => c.phone === n)).toHaveLength(1);
  });

  it("orders contacts by category, sort_order, name_en", () => {
    const police = filterHelp(data.contacts, [], "police").contacts.map((c) => c.name_en);
    expect(police).toEqual(["Alpha Police Station", "Zeta Police Station"]);
    const cats = filterHelp(data.contacts, []).contacts.map((c) => c.category);
    expect(cats).toEqual([...cats].sort());
  });

  it("orders businesses by name only; sponsorship does not move a row up", () => {
    const names = filterHelp([], data.businesses).businesses.map((b) => b.name);
    expect(names).toEqual(["[SAMPLE] Bravo Tours", "[SAMPLE] Yankee Rentals", "[SAMPLE] Zulu Rentals"]);
  });

  it("never returns inactive businesses", () => {
    expect(filterHelp([], data.businesses).businesses.some((b) => !b.is_active)).toBe(false);
    expect(filterHelp([], data.businesses, "rental").businesses.map((b) => b.name)).not.toContain("[SAMPLE] Alpha Closed Shop");
  });

  it("category filters contacts and businesses", () => {
    const r = filterHelp(data.contacts, data.businesses, "rental");
    expect(r.contacts).toEqual([]);
    expect(r.businesses.every((b) => b.category === "rental")).toBe(true);
    const h = filterHelp(data.contacts, data.businesses, "hospital");
    expect(h.contacts.map((c) => c.name_en)).toEqual(["Test Hospital"]);
    expect(h.businesses).toEqual([]);
  });
});

describe("findPrices / getHelp read SAMPLE_DATA_DIR", () => {
  beforeEach(() => {
    vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/content");
    resetSampleCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetSampleCache();
  });

  it("findPrices uses the fixture", async () => expect(await findPrices({ item: "jetski_30min" })).toHaveLength(1));
  it("getHelp uses the fixture and includes hotlines", async () => {
    const r = await getHelp({});
    expect(r.businesses).toHaveLength(3);
    expect(r.contacts.some((c) => c.phone === "1155")).toBe(true);
  });
  it("invalid content fails loudly", async () => {
    vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/does-not-exist");
    resetSampleCache();
    await expect(findPrices({})).rejects.toThrow();
  });
});

// ------------------------------------------------------------------ reports (PDPA)
const FACTS: ReportFacts = {
  incident_type: "scam",
  incident_summary_en: "The shop kept my passport AB1234567 and asked me to call 081-234-5678.",
  date: "2026-11-14",
  time: null,
  location: "Patong",
  parties: [{ role: "business", name: null, description: "owner, phone +66 81 234 5678", vehicle_plate: null }],
  money: { amount: 5000, currency: "THB", type: "demanded", payment_method: "cash" },
  evidence: ["receipt"],
  witnesses: null,
  user_goal: "refund",
  reporter: { nationality: "CN", name: null },
};
const SAVE = { facts: FACTS, markdown: "护照号 E12345678, phone 0812345678. Paid 5,000 baht.", lang: "zh" as const, consent_version: CONSENT_VERSION };
const DAY = 24 * 60 * 60 * 1000;

describe("reports store (SAMPLE_REPORTS_IN_MEMORY=1)", () => {
  beforeEach(() => resetMemoryReports());

  it("saves, returns a long random delete_token and an expiry 30 days out", async () => {
    const now = new Date("2026-11-15T00:00:00Z");
    const r = await saveReport(SAVE, { now });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.delete_token.length).toBeGreaterThanOrEqual(40);
    expect(Date.parse(r.expires_at) - now.getTime()).toBe(30 * DAY);
    const other = await saveReport(SAVE, { now });
    expect(other.delete_token).not.toBe(r.delete_token);
  });

  it("re-scrubs passport and phone numbers server-side, keeping the facts around them", async () => {
    const r = await saveReport(SAVE);
    const got = await getReport(r.id, r.delete_token);
    const stored = JSON.stringify(got);
    expect(stored).not.toMatch(/AB1234567|E12345678|081-234-5678|0812345678|81 234 5678/);
    expect(got?.facts.incident_summary_en).toContain("kept my passport");
    expect(got?.facts.money.amount).toBe(5000);
    expect(got?.markdown).toContain("5,000 baht");
  });

  it("get/delete need the right token; all failures look the same (null/false)", async () => {
    const r = await saveReport(SAVE);
    expect(await getReport(r.id, "x".repeat(43))).toBeNull();
    expect(await getReport("not-a-uuid", r.delete_token)).toBeNull();
    expect(await getReport("00000000-0000-4000-a000-000000000000", r.delete_token)).toBeNull();
    expect(await getReport(r.id, "")).toBeNull();
    expect(await deleteReport(r.id, "x".repeat(43))).toBe(false);
    expect(await getReport(r.id, r.delete_token)).not.toBeNull();
  });

  it("delete removes the row; a second delete is false", async () => {
    const r = await saveReport(SAVE);
    expect(await deleteReport(r.id, r.delete_token)).toBe(true);
    expect(await getReport(r.id, r.delete_token)).toBeNull();
    expect(await deleteReport(r.id, r.delete_token)).toBe(false);
  });

  it("an expired report is treated as missing", async () => {
    const t0 = new Date("2026-11-15T00:00:00Z");
    const r = await saveReport(SAVE, { now: t0 });
    expect(await getReport(r.id, r.delete_token, { now: new Date(t0.getTime() + 29 * DAY) })).not.toBeNull();
    expect(await getReport(r.id, r.delete_token, { now: new Date(t0.getTime() + 30 * DAY + 1) })).toBeNull();
    expect(await deleteReport(r.id, r.delete_token, { now: new Date(t0.getTime() + 31 * DAY) })).toBe(false);
  });

  it("deletes expired rows on each insert", async () => {
    const t0 = new Date("2026-10-01T00:00:00Z");
    await saveReport(SAVE, { now: t0 });
    await saveReport(SAVE, { now: t0 });
    expect(memoryReportCount()).toBe(2);
    await saveReport(SAVE, { now: new Date(t0.getTime() + 31 * DAY) });
    expect(memoryReportCount()).toBe(1);
  });

  it("stores no IP, user agent or passport field", async () => {
    const r = await saveReport(SAVE);
    const got = await getReport(r.id, r.delete_token);
    expect(Object.keys(got ?? {}).sort()).toEqual(["expires_at", "facts", "markdown"]);
    expect(JSON.stringify(got)).not.toMatch(/"(ip|user_agent|passport[a-z_]*)"/i);
  });
});
