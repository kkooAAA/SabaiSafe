// Sample mode data: content/prices.csv + content/help.json, validated, plus the four hotlines from
// lib/hotlines.ts (single source of truth, contracts v0.2 §2.5). Owner: backend.
// Also used by supabase/scripts/build-seed.ts, so the seed gets exactly the same checks.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { HOTLINES, HOTLINE_NUMBERS } from "@/lib/hotlines";
import type { Business, HelpContact, PriceRef } from "@/types/api";
import type { BusinessInsert, HelpContactInsert, PriceInsert } from "@/types/db";
import { CsvSyntaxError, parseCsv } from "./csv";
import { SampleDataError } from "./errors";
import { BusinessSchema, HelpContactSchema, HelpJsonSchema, PRICES_CSV_HEADER, PriceRowSchema } from "./schema";

export type SampleData = { prices: PriceRef[]; contacts: HelpContact[]; businesses: Business[] };
export type SeedData = { prices: PriceInsert[]; contacts: HelpContactInsert[]; businesses: BusinessInsert[] };

/** Stable UUID-shaped id from a natural key, so sample ids don't change between runs. */
export function stableId(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return "invalid";
  return `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`;
}

// ---------------------------------------------------------------- prices.csv

const BOOL: Record<string, boolean> = { true: true, false: false };
const NULLABLE_COLUMNS = new Set(["source_url", "notes", "notes_zh"]);

/** Parses and validates content/prices.csv. Throws SampleDataError("prices.csv:<line>", ...). */
export function parsePricesCsv(text: string): PriceInsert[] {
  let records;
  try {
    records = parseCsv(text);
  } catch (e) {
    if (e instanceof CsvSyntaxError) throw new SampleDataError(`prices.csv:${e.line}`, e.message);
    throw e;
  }
  const [header, ...rows] = records;
  if (!header || header.fields.join(",") !== PRICES_CSV_HEADER.join(",")) {
    throw new SampleDataError("prices.csv:1", `header must be exactly: ${PRICES_CSV_HEADER.join(",")}`);
  }

  const seen = new Map<string, number>();
  return rows.map(({ line, fields }) => {
    const where = `prices.csv:${line}`;
    if (fields.length !== PRICES_CSV_HEADER.length) {
      throw new SampleDataError(where, `expected ${PRICES_CSV_HEADER.length} columns, got ${fields.length}`);
    }
    const raw: Record<string, unknown> = {};
    PRICES_CSV_HEADER.forEach((col, i) => {
      const v = fields[i] ?? "";
      if (v.trim() === "") {
        if (!NULLABLE_COLUMNS.has(col)) throw new SampleDataError(where, `${col} must not be empty`);
        raw[col] = null;
      } else if (col === "min_thb" || col === "max_thb") {
        if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new SampleDataError(where, `${col} must be a plain number like 1000 or 99.50`);
        raw[col] = Number(v);
      } else if (col === "is_fixed_by_law" || col === "is_sample") {
        if (!(v in BOOL)) throw new SampleDataError(where, `${col} must be true or false`);
        raw[col] = BOOL[v];
      } else {
        raw[col] = v;
      }
    });
    const parsed = PriceRowSchema.safeParse(raw);
    if (!parsed.success) throw new SampleDataError(where, firstIssue(parsed.error));
    const r = parsed.data;
    const key = `${r.item_key}|${r.area}|${r.source}|${r.collected_at}`;
    const dup = seen.get(key);
    if (dup) throw new SampleDataError(where, `duplicate of line ${dup} (item_key, area, source, collected_at)`);
    seen.set(key, line);
    return r;
  });
}

// ---------------------------------------------------------------- help.json

/** The four hotlines as help_contacts rows (§2.5). Never read from help.json. */
export function hotlineContacts(): HelpContactInsert[] {
  return HOTLINES.map((h, i) => ({
    category: h.key === "consumer" ? "consumer" : "emergency",
    name_en: h.name_en,
    name_zh: h.name_zh,
    name_th: h.name_th,
    phone: h.number,
    address: null,
    area: null,
    google_maps_url: null,
    website: null,
    hours: null,
    languages: [],
    source_url: null,
    sort_order: i + 1,
    verified: true,
    is_sample: false,
  }));
}

export function parseHelpJson(json: unknown): { contacts: HelpContactInsert[]; businesses: BusinessInsert[] } {
  const top = HelpJsonSchema.safeParse(json);
  if (!top.success) throw new SampleDataError("help.json", `must be {"contacts": [...], "businesses": [...]}: ${firstIssue(top.error)}`);

  const contacts = top.data.contacts.map((c, i) => {
    const where = `help.json:contacts[${i}]`;
    const p = HelpContactSchema.safeParse(c);
    if (!p.success) throw new SampleDataError(where, firstIssue(p.error));
    if (p.data.phone && HOTLINE_NUMBERS.includes(p.data.phone)) {
      throw new SampleDataError(where, "the four hotlines must not be in help.json (they come from lib/hotlines.ts)");
    }
    return p.data;
  });
  const contactKeys = new Set<string>();
  contacts.forEach((c, i) => {
    const k = `${c.category}|${c.name_en}`;
    if (contactKeys.has(k)) throw new SampleDataError(`help.json:contacts[${i}]`, "duplicate (category, name_en)");
    contactKeys.add(k);
  });

  const businesses = top.data.businesses.map((b, i) => {
    const p = BusinessSchema.safeParse(b);
    if (!p.success) throw new SampleDataError(`help.json:businesses[${i}]`, firstIssue(p.error));
    return p.data;
  });
  const businessKeys = new Set<string>();
  businesses.forEach((b, i) => {
    const k = `${b.name}|${b.area}`;
    if (businessKeys.has(k)) throw new SampleDataError(`help.json:businesses[${i}]`, "duplicate (name, area)");
    businessKeys.add(k);
  });

  return { contacts, businesses };
}

/** Validated rows for seed.sql: help.json + prices.csv + the four hotlines. */
export function loadSeedData(csvText: string, helpJson: unknown): SeedData {
  const prices = parsePricesCsv(csvText);
  const help = parseHelpJson(helpJson);
  return { prices, contacts: [...hotlineContacts(), ...help.contacts], businesses: help.businesses };
}

/** Pure loader (no fs): validated rows with stable ids. qa can pass fixture text. */
export function loadSampleData(csvText: string, helpJson: unknown): SampleData {
  const seed = loadSeedData(csvText, helpJson);
  return {
    prices: seed.prices.map((p) => ({ id: stableId("price", p.item_key, p.area, p.source, p.collected_at), ...p })),
    contacts: seed.contacts.map((c) => ({ id: stableId("contact", c.category, c.name_en), ...c })),
    businesses: seed.businesses.map((b) => ({ id: stableId("business", b.name, b.area), ...b })),
  };
}

/** Directory with prices.csv and help.json: env SAMPLE_DATA_DIR (tests) or <cwd>/content. */
export function sampleDataDir(): string {
  return path.resolve(process.cwd(), process.env.SAMPLE_DATA_DIR?.trim() || "content");
}

export function readSampleFiles(dir = sampleDataDir()): { csvText: string; helpJson: unknown } {
  const csvText = readFileSync(path.join(dir, "prices.csv"), "utf8");
  const helpText = readFileSync(path.join(dir, "help.json"), "utf8");
  let helpJson: unknown;
  try {
    helpJson = JSON.parse(helpText);
  } catch (e) {
    throw new SampleDataError("help.json", `invalid JSON: ${(e as Error).message}`);
  }
  return { csvText, helpJson };
}

let cache: { dir: string; data: SampleData } | null = null;

/** Sample data from disk, cached per directory. Invalid content throws SampleDataError (loudly, on purpose). */
export function getSampleData(): SampleData {
  const dir = sampleDataDir();
  if (cache?.dir === dir) return cache.data;
  const { csvText, helpJson } = readSampleFiles(dir);
  const data = loadSampleData(csvText, helpJson);
  cache = { dir, data };
  return data;
}

/** Tests only. */
export function resetSampleCache(): void {
  cache = null;
}

// ---------------------------------------------------------------- admin overlay (sample mode)
// Admin writes in sample mode go to an in-memory copy of the sample prices and businesses (demo only, lost on
// restart). It lives on globalThis because `next dev` gives every route its own copy of this module, and
// /api/admin/*, /api/price, /api/help and the pages must all see the same data. Contacts are never edited.

export type SampleOverlay = { prices: PriceRef[]; businesses: Business[] };

declare global {
  var __sabaisafeAdmin: SampleOverlay | undefined;
}

/** The overlay if an admin write created one, else undefined (read the sample data instead). */
export function sampleOverlay(): SampleOverlay | undefined {
  return globalThis.__sabaisafeAdmin;
}

/** The overlay, created from the sample data on first use. */
export function ensureSampleOverlay(): SampleOverlay {
  if (!globalThis.__sabaisafeAdmin) {
    const d = getSampleData();
    globalThis.__sabaisafeAdmin = structuredClone({ prices: d.prices, businesses: d.businesses });
  }
  return globalThis.__sabaisafeAdmin;
}

/** Tests only: drop admin edits made in sample mode. */
export function resetAdminOverlay(): void {
  globalThis.__sabaisafeAdmin = undefined;
}
