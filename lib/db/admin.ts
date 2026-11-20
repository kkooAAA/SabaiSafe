// Admin CRUD for prices and businesses. Owner: backend. Contracts §3.9 (v0.6).
// - Auth is in middleware.ts; nothing here checks it.
// - DB mode uses the service-role client. Sample mode writes to an in-memory overlay on globalThis
//   (lib/db/sample.ts), so `persisted` is false and the edits are lost on restart.
// - Bodies arrive as `unknown` and are validated here with the same schemas as the loader and seed
//   (lib/db/schema.ts). PATCH merges into the stored row, then re-checks the whole row.
// - Every write clears the price/help caches, so /api/price, /api/help and findPrices/getHelp see it.
// - Errors: ValidationError (400), ConflictError (409), DbUnavailableError (503), DbError (500). A missing or
//   malformed id returns null/false (→ 404). Postgres messages are kept as `cause` for logs only.
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Business, BusinessInput, PriceInput, PriceRef } from "@/types/api";
import { createServiceClient, isSampleMode } from "./client";
import { ConflictError, DbError, ValidationError } from "./errors";
import { resetHelpCache } from "./help";
import { resetPriceCache } from "./prices";
import { ensureSampleOverlay, getSampleData, resetAdminOverlay, sampleOverlay } from "./sample";
import { BusinessPatchSchema, BusinessSchema, PricePatchSchema, PriceRowSchema, fieldErrors } from "./schema";

export { resetAdminOverlay };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 5000;
const PRICE_COLUMNS =
  "id,item_key,item_name_en,item_name_zh,category,area,min_thb,max_thb,unit,is_fixed_by_law,source,source_url,collected_at,notes,notes_zh,is_sample";
const BUSINESS_COLUMNS =
  "id,name,name_zh,category,area,address,phone,website,google_maps_url,source_url,description_en,description_zh,criteria_met,is_sponsored,verified_at,is_active,is_sample";

/** true with Supabase; false in sample mode (in-memory overlay, lost on restart). */
export function isPersisted(): boolean {
  return !isSampleMode();
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
const byPrice = (a: PriceRef, b: PriceRef) =>
  cmp(a.category, b.category) || cmp(a.item_name_en, b.item_name_en) || cmp(a.area, b.area);
// Sponsorship never changes ordering (§2.4): name only.
const byBusiness = (a: Business, b: Business) => cmp(a.name, b.name) || cmp(a.area, b.area);

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError({ body: "must be a JSON object" });
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError(fieldErrors(r.error));
  return r.data;
}

function parsePatch<T extends object>(schema: z.ZodType<T>, body: unknown): T {
  const patch = parse(schema, body);
  if (Object.keys(patch).length === 0) throw new ValidationError({ body: "send at least one field to change" });
  return patch;
}

function withoutId<T extends { id: string }>(row: T): Omit<T, "id"> {
  const { id: _id, ...rest } = row;
  void _id;
  return rest;
}

function invalidate(): void {
  resetPriceCache();
  resetHelpCache();
}

function priceKey(p: PriceInput): string {
  return `${p.item_key}|${p.area}|${p.source}|${p.collected_at}`;
}
function businessKey(b: BusinessInput): string {
  return `${b.name}|${b.area}`;
}
const PRICE_CONFLICT = "A price with the same item_key, area, source and collected_at already exists.";
const BUSINESS_CONFLICT = "A business with the same name and area already exists.";

/** Postgres error → typed error. 23505 unique → 409; CHECK / NOT NULL / bad value → 400; else 500. */
function pgError(error: { code?: string } | null, conflictMessage: string, what: string): Error {
  switch (error?.code) {
    case "23505":
      return new ConflictError(conflictMessage);
    case "23514":
    case "23502":
    case "22P02":
    case "22007":
    case "22008":
      return new ValidationError({ body: "rejected by a database check" });
    default:
      return new DbError(what, { cause: error });
  }
}

function toPrice(r: Record<string, unknown>): PriceRef {
  return { ...(r as PriceRef), min_thb: Number(r.min_thb), max_thb: Number(r.max_thb) };
}

// ---------------------------------------------------------------- prices

export async function listAdminPrices(): Promise<PriceRef[]> {
  if (isSampleMode()) return [...(sampleOverlay()?.prices ?? getSampleData().prices)].sort(byPrice);
  const { data, error } = await createServiceClient().from("prices").select(PRICE_COLUMNS).limit(MAX_ROWS);
  if (error) throw new DbError("Failed to list prices", { cause: error });
  return (data ?? []).map(toPrice).sort(byPrice);
}

export async function createAdminPrice(body: unknown): Promise<PriceRef> {
  const input: PriceInput = parse(PriceRowSchema, body);
  if (isSampleMode()) {
    const o = ensureSampleOverlay();
    if (o.prices.some((p) => priceKey(p) === priceKey(input))) throw new ConflictError(PRICE_CONFLICT);
    const row: PriceRef = { id: randomUUID(), ...input };
    o.prices.push(row);
    invalidate();
    return structuredClone(row);
  }
  const { data, error } = await createServiceClient().from("prices").insert(input).select(PRICE_COLUMNS).single();
  if (error || !data) throw pgError(error, PRICE_CONFLICT, "Failed to create price");
  invalidate();
  return toPrice(data);
}

/** null ⇒ no such id (404). */
export async function updateAdminPrice(id: string, body: unknown): Promise<PriceRef | null> {
  const patch = parsePatch(PricePatchSchema, body);
  if (!UUID_RE.test(id)) return null;
  if (isSampleMode()) {
    const o = ensureSampleOverlay();
    const i = o.prices.findIndex((p) => p.id === id.toLowerCase());
    const stored = o.prices[i];
    if (!stored) return null;
    const merged: PriceInput = parse(PriceRowSchema, { ...withoutId(stored), ...patch });
    if (o.prices.some((p, j) => j !== i && priceKey(p) === priceKey(merged))) throw new ConflictError(PRICE_CONFLICT);
    const row: PriceRef = { id: stored.id, ...merged };
    o.prices[i] = row;
    invalidate();
    return structuredClone(row);
  }
  const db = createServiceClient();
  const cur = await db.from("prices").select(PRICE_COLUMNS).eq("id", id).maybeSingle();
  if (cur.error) throw new DbError("Failed to read price", { cause: cur.error });
  if (!cur.data) return null;
  const merged: PriceInput = parse(PriceRowSchema, { ...withoutId(toPrice(cur.data)), ...patch });
  const { data, error } = await db.from("prices").update(merged).eq("id", id).select(PRICE_COLUMNS).maybeSingle();
  if (error) throw pgError(error, PRICE_CONFLICT, "Failed to update price");
  if (!data) return null; // deleted meanwhile
  invalidate();
  return toPrice(data);
}

/** Hard delete. false ⇒ no such id (404). */
export async function deleteAdminPrice(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  if (isSampleMode()) {
    const o = ensureSampleOverlay();
    const i = o.prices.findIndex((p) => p.id === id.toLowerCase());
    if (i < 0) return false;
    o.prices.splice(i, 1);
    invalidate();
    return true;
  }
  const { error, count } = await createServiceClient().from("prices").delete({ count: "exact" }).eq("id", id);
  if (error) throw new DbError("Failed to delete price", { cause: error });
  if (!count) return false;
  invalidate();
  return true;
}

// ---------------------------------------------------------------- businesses

/** All businesses, including inactive ones, ordered by name. */
export async function listAdminBusinesses(): Promise<Business[]> {
  if (isSampleMode()) return [...(sampleOverlay()?.businesses ?? getSampleData().businesses)].sort(byBusiness);
  const { data, error } = await createServiceClient().from("businesses").select(BUSINESS_COLUMNS).limit(MAX_ROWS);
  if (error) throw new DbError("Failed to list businesses", { cause: error });
  return ((data ?? []) as Business[]).sort(byBusiness);
}

export async function createAdminBusiness(body: unknown): Promise<Business> {
  const input: BusinessInput = parse(BusinessSchema, body);
  if (isSampleMode()) {
    const o = ensureSampleOverlay();
    if (o.businesses.some((b) => businessKey(b) === businessKey(input))) throw new ConflictError(BUSINESS_CONFLICT);
    const row: Business = { id: randomUUID(), ...input };
    o.businesses.push(row);
    invalidate();
    return structuredClone(row);
  }
  const { data, error } = await createServiceClient().from("businesses").insert(input).select(BUSINESS_COLUMNS).single();
  if (error || !data) throw pgError(error, BUSINESS_CONFLICT, "Failed to create business");
  invalidate();
  return data as Business;
}

/** null ⇒ no such id (404). PATCH {is_active: true} re-activates a soft-deleted business. */
export async function updateAdminBusiness(id: string, body: unknown): Promise<Business | null> {
  const patch = parsePatch(BusinessPatchSchema, body);
  if (!UUID_RE.test(id)) return null;
  if (isSampleMode()) {
    const o = ensureSampleOverlay();
    const i = o.businesses.findIndex((b) => b.id === id.toLowerCase());
    const stored = o.businesses[i];
    if (!stored) return null;
    const merged: BusinessInput = parse(BusinessSchema, { ...withoutId(stored), ...patch });
    if (o.businesses.some((b, j) => j !== i && businessKey(b) === businessKey(merged))) {
      throw new ConflictError(BUSINESS_CONFLICT);
    }
    const row: Business = { id: stored.id, ...merged };
    o.businesses[i] = row;
    invalidate();
    return structuredClone(row);
  }
  const db = createServiceClient();
  const cur = await db.from("businesses").select(BUSINESS_COLUMNS).eq("id", id).maybeSingle();
  if (cur.error) throw new DbError("Failed to read business", { cause: cur.error });
  if (!cur.data) return null;
  const merged: BusinessInput = parse(BusinessSchema, { ...withoutId(cur.data as Business), ...patch });
  const { data, error } = await db.from("businesses").update(merged).eq("id", id).select(BUSINESS_COLUMNS).maybeSingle();
  if (error) throw pgError(error, BUSINESS_CONFLICT, "Failed to update business");
  if (!data) return null;
  invalidate();
  return data as Business;
}

/**
 * Soft delete (is_active = false); repeating it is harmless. null ⇒ no such id (404). Not re-validated: hiding a
 * row must work even if it predates a rule.
 */
export async function deleteAdminBusiness(id: string): Promise<Business | null> {
  if (!UUID_RE.test(id)) return null;
  if (isSampleMode()) {
    const o = ensureSampleOverlay();
    const stored = o.businesses.find((b) => b.id === id.toLowerCase());
    if (!stored) return null;
    stored.is_active = false;
    invalidate();
    return structuredClone(stored);
  }
  const { data, error } = await createServiceClient()
    .from("businesses")
    .update({ is_active: false })
    .eq("id", id)
    .select(BUSINESS_COLUMNS)
    .maybeSingle();
  if (error) throw new DbError("Failed to deactivate business", { cause: error });
  if (!data) return null;
  invalidate();
  return data as Business;
}
