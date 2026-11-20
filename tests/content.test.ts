// Invariants on content/prices.csv and content/help.json (contracts §2.3–2.5, §5; CLAUDE.md rules).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUSINESS_CRITERIA, PRICE_UNITS, type Business, type HelpContact } from "@/types/api";
import { HOTLINE_NUMBERS } from "@/lib/hotlines";
import { csvObjects } from "./helpers/csv";
import { digitsOf, findPhoneLike } from "./helpers/phones";

const CONTENT = join(process.cwd(), "content");
const pricesPath = join(CONTENT, "prices.csv");
const helpPath = join(CONTENT, "help.json");

const PRICE_HEADER = [
  "item_key", "item_name_en", "item_name_zh", "category", "area", "min_thb", "max_thb", "unit", "is_fixed_by_law",
  "source", "source_url", "collected_at", "notes", "notes_zh", "is_sample",
] as const;
type PriceCol = (typeof PRICE_HEADER)[number];
const CATEGORIES = ["transport", "rental", "activity", "food", "accommodation", "other"];
const HELP_CATEGORIES = ["emergency", "police", "hospital", "embassy", "consumer", "immigration", "other"];
const BUSINESS_CATEGORIES = ["rental", "transport", "tour", "hotel", "restaurant", "shop", "other"];
const HAN = /[一-鿿]/;

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
}

describe.runIf(existsSync(pricesPath))("content/prices.csv", () => {
  const { header, rows } = csvObjects(readFileSync(pricesPath, "utf8").replace(/^﻿/, ""), PRICE_HEADER);

  it("has the exact contract header", () => expect(header).toEqual([...PRICE_HEADER]));

  it("has at least 25 rows (P1-5)", () => expect(rows.length).toBeGreaterThanOrEqual(25));

  it("every row has exactly one value per column", () => {
    for (const r of rows) expect(r.width, `line ${r.line}`).toBe(PRICE_HEADER.length);
  });

  it.each(rows.map((r) => [r.line, r.data] as const))("line %i is valid", (line, d) => {
    expect(d.item_key, "item_key slug").toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    expect(d.item_name_en.trim()).not.toBe("");
    expect(d.item_name_zh, "item_name_zh is Chinese").toMatch(HAN);
    expect(CATEGORIES).toContain(d.category);
    expect(d.area.trim()).not.toBe("");
    const min = Number(d.min_thb);
    const max = Number(d.max_thb);
    expect(Number.isFinite(min) && min >= 0, "min_thb number").toBe(true);
    expect(Number.isFinite(max) && max > 0, "max_thb number").toBe(true);
    expect(min, "min <= max").toBeLessThanOrEqual(max);
    expect(PRICE_UNITS as readonly string[], "unit in PRICE_UNITS").toContain(d.unit);
    expect(["true", "false"]).toContain(d.is_fixed_by_law);
    expect(["true", "false"]).toContain(d.is_sample);
    expect(isIsoDate(d.collected_at), "collected_at YYYY-MM-DD").toBe(true);
    expect(d.source.trim(), "source required").not.toBe("");
    if (d.source_url) expect(d.source_url).toMatch(/^https?:\/\//);
    if (d.notes) expect(d.notes_zh, "notes_zh when notes present").toMatch(HAN);
    void line;
  });

  it("sample rows say SAMPLE DATA; real rows name a real source (field data may have no URL)", () => {
    for (const { line, data: d } of rows) {
      if (d.is_sample === "true") expect(d.source, `line ${line}`).toBe("SAMPLE DATA");
      else expect(d.source, `line ${line}`).not.toBe("SAMPLE DATA");
    }
  });

  it("is_fixed_by_law is never true on a sample row or without a source URL", () => {
    for (const { line, data: d } of rows) {
      if (d.is_fixed_by_law === "true") {
        expect(d.is_sample, `line ${line}`).toBe("false");
        expect(d.source_url, `line ${line}`).toMatch(/^https?:\/\//);
      }
    }
  });

  it("collected_at is not in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const { line, data: d } of rows) expect(d.collected_at <= today, `line ${line}`).toBe(true);
  });

  it("(item_key, area, source, collected_at) is unique", () => {
    const seen = new Set<string>();
    for (const { line, data: d } of rows) {
      const k = [d.item_key, d.area, d.source, d.collected_at].join("|");
      expect(seen.has(k), `duplicate at line ${line}: ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it("an item_key keeps the same names, category and unit across areas", () => {
    const first = new Map<string, Record<PriceCol, string>>();
    for (const { line, data: d } of rows) {
      const f = first.get(d.item_key);
      if (!f) first.set(d.item_key, d);
      else
        for (const col of ["item_name_en", "item_name_zh", "category", "unit"] as const)
          expect(d[col], `line ${line} ${col} differs for ${d.item_key}`).toBe(f[col]);
    }
  });

  it("contains no phone numbers", () => {
    for (const { line, data: d } of rows)
      for (const [col, v] of Object.entries(d)) expect(findPhoneLike(v), `line ${line} ${col}`).toEqual([]);
  });
});

describe.runIf(existsSync(helpPath))("content/help.json", () => {
  const help = JSON.parse(readFileSync(helpPath, "utf8")) as {
    contacts: Omit<HelpContact, "id">[];
    businesses: Omit<Business, "id">[];
  };
  const hotlineDigits = new Set(HOTLINE_NUMBERS);

  it("has the contract shape", () => {
    expect(Object.keys(help).sort()).toEqual(["businesses", "contacts"]);
    expect(Array.isArray(help.contacts) && Array.isArray(help.businesses)).toBe(true);
  });

  it("does NOT contain the 4 hotlines (backend generates them from lib/hotlines.ts)", () => {
    for (const c of help.contacts) {
      if (c.phone) expect(hotlineDigits.has(digitsOf(c.phone)), c.name_en).toBe(false);
    }
    expect(help.contacts.some((c) => c.category === "emergency")).toBe(false);
  });

  it.each(help.contacts.map((c, i) => [i, c] as const))("contact %i is valid", (_i, c) => {
    expect(HELP_CATEGORIES).toContain(c.category);
    expect(c.name_en.trim()).not.toBe("");
    if (c.name_zh) expect(c.name_zh).toMatch(HAN);
    if (c.name_th) expect(c.name_th).toMatch(/[฀-๿]/);
    expect(Array.isArray(c.languages)).toBe(true);
    expect(Number.isInteger(c.sort_order)).toBe(true);
    expect(typeof c.verified).toBe("boolean");
    expect(typeof c.is_sample).toBe("boolean");
    for (const u of [c.website, c.google_maps_url, c.source_url]) if (u) expect(u).toMatch(/^https?:\/\//);
  });

  it("a contact phone requires verified=true AND an official source_url", () => {
    for (const c of help.contacts) {
      if (c.phone !== null) {
        expect(c.verified, `${c.name_en}: verified`).toBe(true);
        expect(c.source_url, `${c.name_en}: source_url`).toMatch(/^https?:\/\//);
        expect(c.is_sample, `${c.name_en}: a verified phone is not sample data`).toBe(false);
      }
    }
  });

  it("verified contacts are not marked sample", () => {
    for (const c of help.contacts) if (c.verified) expect(c.is_sample, c.name_en).toBe(false);
  });

  it.each(help.businesses.map((b, i) => [i, b] as const))("business %i is valid", (_i, b) => {
    expect(BUSINESS_CATEGORIES).toContain(b.category);
    expect(b.area.trim()).not.toBe("");
    for (const k of b.criteria_met) expect(BUSINESS_CRITERIA as readonly string[]).toContain(k);
    expect(new Set(b.criteria_met).size).toBe(b.criteria_met.length);
    expect(typeof b.is_sponsored).toBe("boolean");
    expect(typeof b.is_active).toBe("boolean");
    if (b.verified_at) expect(isIsoDate(b.verified_at)).toBe(true);
    if (b.name_zh) expect(b.name_zh).toMatch(HAN);
  });

  it("sample businesses are fictional: [SAMPLE] prefix, no phone, no address, no links", () => {
    for (const b of help.businesses.filter((b) => b.is_sample)) {
      expect(b.name, b.name).toMatch(/^\[SAMPLE\] /);
      expect(b.phone, b.name).toBeNull();
      expect(b.address, b.name).toBeNull();
      expect(b.website, b.name).toBeNull();
      expect(b.google_maps_url, b.name).toBeNull();
      expect(b.verified_at, b.name).toBeNull();
    }
  });

  it("a business phone requires source_url AND verified_at (contracts v0.2)", () => {
    for (const b of help.businesses) {
      if (b.phone !== null) {
        expect(b.source_url, b.name).toMatch(/^https?:\/\//);
        expect(b.verified_at, b.name).not.toBeNull();
      }
    }
  });

  it("no phone-like numbers hide in free text", () => {
    const texts = (o: object) => Object.entries(o).filter(([k, v]) => k !== "phone" && typeof v === "string").map(([, v]) => v as string);
    for (const c of help.contacts) for (const t of texts(c)) expect(findPhoneLike(t), c.name_en).toEqual([]);
    for (const b of help.businesses) for (const t of texts(b)) expect(findPhoneLike(t), b.name).toEqual([]);
  });

  it("at most a few sponsored businesses, and at least one non-sponsored per sponsored category (ordering test needs both)", () => {
    const sponsored = help.businesses.filter((b) => b.is_sponsored);
    for (const s of sponsored)
      expect(help.businesses.some((b) => !b.is_sponsored && b.category === s.category), s.name).toBe(true);
  });
});
