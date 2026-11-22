// Pure helpers for the admin forms (contracts §2.3, §2.4, §3.9). No React, no fetch: unit-testable by qa.
import { BUSINESS_CRITERIA, PRICE_UNITS } from "@/types/protocol";
import type { Business, PriceRef } from "@/types/api";
import { AREAS, BUSINESS_CATEGORIES, PHONE_RE, PRICE_CATEGORIES } from "@/lib/db/schema";

export type Entity = "prices" | "businesses";
export type Row<E extends Entity> = E extends "prices" ? PriceRef : Business;
export type Body<E extends Entity> = Omit<Row<E>, "id">;

export type FieldKind = "text" | "textarea" | "url" | "number" | "date" | "select" | "checkbox" | "checkboxes";

export type FieldSpec = {
  name: string;
  kind: FieldKind;
  /** Required for create; an empty value is an error. */
  required?: boolean;
  /** Empty input is stored as null (nullable column). */
  nullable?: boolean;
  /** Option keys for select / checkboxes; labels come from messages (see optionLabelKey). */
  options?: readonly string[];
  /** Messages namespace for option labels, e.g. "price.unit" → t("price.unit.per_trip"). None: the key is the label. */
  optionNs?: string;
};

// Constants and regexes come from the server schema (pure: zod + types/api; lint exception for this one import),
// so the client checks cannot drift from the server's. Only constants are imported, not the zod schemas.
export { PRICE_CATEGORIES, BUSINESS_CATEGORIES };
/** Areas from contracts §5 (prices.csv). */
export const KNOWN_AREAS = AREAS;

export const FIELDS: { [E in Entity]: readonly FieldSpec[] } = {
  prices: [
    { name: "item_key", kind: "text", required: true },
    { name: "item_name_en", kind: "text", required: true },
    { name: "item_name_zh", kind: "text", required: true },
    { name: "category", kind: "select", required: true, options: PRICE_CATEGORIES, optionNs: "price.category" },
    { name: "area", kind: "select", required: true, options: KNOWN_AREAS },
    { name: "min_thb", kind: "number", required: true },
    { name: "max_thb", kind: "number", required: true },
    { name: "unit", kind: "select", required: true, options: PRICE_UNITS, optionNs: "price.unit" },
    { name: "is_fixed_by_law", kind: "checkbox" },
    { name: "source", kind: "text", required: true },
    { name: "source_url", kind: "url", nullable: true },
    { name: "collected_at", kind: "date", required: true },
    { name: "notes", kind: "textarea", nullable: true },
    { name: "notes_zh", kind: "textarea", nullable: true },
    { name: "is_sample", kind: "checkbox" },
  ],
  businesses: [
    { name: "name", kind: "text", required: true },
    { name: "name_zh", kind: "text", nullable: true },
    { name: "category", kind: "select", required: true, options: BUSINESS_CATEGORIES, optionNs: "help.businessCategory" },
    { name: "area", kind: "select", required: true, options: KNOWN_AREAS },
    { name: "address", kind: "text", nullable: true },
    { name: "phone", kind: "text", nullable: true },
    { name: "website", kind: "url", nullable: true },
    { name: "google_maps_url", kind: "url", nullable: true },
    { name: "source_url", kind: "url", nullable: true },
    { name: "description_en", kind: "textarea", nullable: true },
    { name: "description_zh", kind: "textarea", nullable: true },
    { name: "criteria_met", kind: "checkboxes", options: BUSINESS_CRITERIA, optionNs: "help.criteria" },
    { name: "verified_at", kind: "date", nullable: true },
    { name: "is_sponsored", kind: "checkbox" },
    { name: "is_active", kind: "checkbox" },
    { name: "is_sample", kind: "checkbox" },
  ],
};

/** Form state: strings for inputs, booleans for checkboxes, string[] for checkbox groups. */
export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;
export type FieldErrors = Record<string, string>;

export function emptyValues(entity: Entity): FormValues {
  const v: FormValues = {};
  for (const f of FIELDS[entity]) {
    if (f.kind === "checkbox") v[f.name] = f.name === "is_active"; // admin enters real data: is_sample off by default
    else if (f.kind === "checkboxes") v[f.name] = [];
    else if (f.kind === "select") v[f.name] = f.options?.[0] ?? "";
    else v[f.name] = "";
  }
  return v;
}

export function toFormValues(entity: Entity, row: Partial<Record<string, unknown>>): FormValues {
  const v = emptyValues(entity);
  for (const f of FIELDS[entity]) {
    const x = row[f.name];
    if (f.kind === "checkbox") v[f.name] = x === true;
    else if (f.kind === "checkboxes") v[f.name] = Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
    else v[f.name] = x === null || x === undefined ? "" : String(x);
  }
  return v;
}

/** Parses "1,200", " 300 ", full-width digits. Returns null for empty, NaN for invalid. */
export function parseNumber(s: string): number | null {
  const t = s
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[,\s]/g, "")
    .trim();
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Same as the server's isoDate: rejects impossible dates such as 2026-02-30. */
export const isRealDate = (s: string) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};
/** Same regex as the server's httpUrl. */
export const HTTP_URL_RE = /^https?:\/\/\S+$/;
/** Same regex as the server's item_key. */
export const ITEM_KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
/** numeric(10,2) upper bound, as on the server. */
export const MAX_THB = 99_999_999.99;
const hasAtMost2Decimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
export const SAMPLE_SOURCE = "SAMPLE DATA";
export const SAMPLE_NAME_PREFIX = "[SAMPLE] ";

/**
 * Form → request body, with client-side checks that mirror the server's (the server is the authority and
 * may return more errors). Error values are message keys under `admin.errors`.
 */
export function fromFormValues<E extends Entity>(
  entity: E,
  values: FormValues,
  /** The row being edited: its stored select values stay valid even if no longer in the option list. */
  original?: Partial<Record<string, unknown>>,
): { ok: true; body: Body<E> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const body: Record<string, unknown> = {};
  for (const f of FIELDS[entity]) {
    const raw = values[f.name];
    if (f.kind === "checkbox") {
      body[f.name] = raw === true;
      continue;
    }
    if (f.kind === "checkboxes") {
      const set = new Set(Array.isArray(raw) ? raw : []);
      body[f.name] = (f.options ?? []).filter((o) => set.has(o));
      continue;
    }
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s) {
      if (f.required) errors[f.name] = "required";
      body[f.name] = f.nullable ? null : "";
      continue;
    }
    if (f.kind === "number") {
      const n = parseNumber(s);
      if (n === null || Number.isNaN(n)) errors[f.name] = "number";
      else if (!hasAtMost2Decimals(n)) errors[f.name] = "decimals";
      else if (n > MAX_THB) errors[f.name] = "too_large";
      else body[f.name] = n;
    } else if (f.kind === "date") {
      if (!isRealDate(s)) errors[f.name] = "date";
      else body[f.name] = s;
    } else if (f.kind === "url") {
      if (!HTTP_URL_RE.test(s)) errors[f.name] = "url";
      else body[f.name] = s;
    } else if (f.kind === "select") {
      if (f.options && !f.options.includes(s) && original?.[f.name] !== s) errors[f.name] = "option";
      else body[f.name] = s;
    } else {
      body[f.name] = s;
    }
  }
  if (entity === "prices") {
    if (!errors.min_thb && !errors.max_thb && (body.min_thb as number) > (body.max_thb as number)) errors.max_thb = "min_max";
    if (body.is_fixed_by_law === true && !body.source_url && !errors.source_url) errors.source_url = "fixed_needs_source";
    if (typeof body.item_key === "string" && body.item_key && !ITEM_KEY_RE.test(body.item_key)) errors.item_key = "slug";
    if (body.source === SAMPLE_SOURCE && (body.is_sample !== true || body.is_fixed_by_law === true)) errors.is_sample = "sample_source";
  } else {
    if (typeof body.phone === "string" && body.phone && !PHONE_RE.test(body.phone)) errors.phone = "phone_format";
    if (body.phone && !body.source_url && !errors.source_url) errors.source_url = "phone_needs_source";
    if (body.phone && !body.verified_at && !errors.verified_at) errors.verified_at = "phone_needs_verified";
    if (body.is_sample === true) {
      if (typeof body.name === "string" && body.name && !body.name.startsWith(SAMPLE_NAME_PREFIX)) errors.name = "sample_name";
      for (const k of ["phone", "website", "google_maps_url"] as const) {
        const v = values[k];
        // The more useful message for a fictional business: remove the contact, not reformat it.
        if (typeof v === "string" && v.trim()) errors[k] = "sample_no_contact";
      }
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, body: body as Body<E> };
}

/** Only the fields that changed, for PATCH. */
export function diffBody(original: Partial<Record<string, unknown>>, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(original[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v;
  }
  return out;
}

/**
 * Field errors from an API error body `{ error: { code, message, fields?: { path: message } } }`.
 * "criteria_met.2" → "criteria_met". Server messages are shown as given (admin is English-first).
 */
export function apiFieldErrors(body: unknown): FieldErrors {
  const fields = (body as { error?: { fields?: unknown } } | null)?.error?.fields;
  if (!fields || typeof fields !== "object") return {};
  const out: FieldErrors = {};
  for (const [path, msg] of Object.entries(fields as Record<string, unknown>)) {
    const key = path.split(".")[0] ?? path;
    if (typeof msg === "string" && !(key in out)) out[key] = msg;
  }
  return out;
}

/** Case-insensitive search over the visible text columns. */
export function searchRows<T extends PriceRef | Business>(rows: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => {
    const hay =
      "item_key" in r
        ? [r.item_key, r.item_name_en, r.item_name_zh, r.area, r.source]
        : [r.name, r.name_zh ?? "", r.area, r.category];
    return hay.some((s) => s.toLowerCase().includes(needle));
  });
}
