// Pure filter/sort rules shared by sample mode and DB mode, so both behave identically.
// Contracts v0.2 §3.6 (prices) and §3.8 / §2.4 / §2.5 (help). Owner: backend.
import type { Business, HelpContact, HelpResponse, PriceRef } from "@/types/api";
import { stableId, hotlineContacts } from "./sample";
import { ISLAND_WIDE_AREA } from "./schema";

export const MAX_PRICE_ROWS = 100;

/** Plain code-unit comparison: deterministic, independent of locale and DB collation. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type PriceQuery = { item?: string | null; area?: string | null };

/** Lower-case and drop whitespace, hyphens and underscores: "Jet Ski", "jet-ski", "jet_ski" → "jetski". */
export function normalizeItem(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * §3.6: `item` = item_key, or substring of item_name_en / item_name_zh, compared after normalizeItem on both
 * sides (case, spaces, hyphens and underscores ignored). A query that normalizes to "" matches nothing.
 * `area` = case-insensitive substring of area; island-wide rows (area = "Phuket") are always included.
 * Each row is tested once, so it can never appear twice. Ordered by category, item_name_en, area; max 100.
 */
export function filterPrices(rows: readonly PriceRef[], q: PriceQuery): PriceRef[] {
  const hasItem = Boolean(q.item?.trim());
  const item = normalizeItem(q.item ?? "");
  const area = q.area?.trim().toLowerCase() ?? "";
  return rows
    .filter(
      (r) =>
        !hasItem ||
        (item !== "" &&
          (normalizeItem(r.item_key) === item ||
            normalizeItem(r.item_name_en).includes(item) ||
            normalizeItem(r.item_name_zh).includes(item))),
    )
    .filter((r) => !area || r.area === ISLAND_WIDE_AREA || r.area.toLowerCase().includes(area))
    .sort((a, b) => cmp(a.category, b.category) || cmp(a.item_name_en, b.item_name_en) || cmp(a.area, b.area))
    .slice(0, MAX_PRICE_ROWS);
}

/** Adds any of the four hotlines missing from `contacts` (matched by phone), so they are always returned. */
export function withHotlines(contacts: readonly HelpContact[]): HelpContact[] {
  const present = new Set(contacts.map((c) => c.phone));
  const missing = hotlineContacts()
    .filter((h) => !present.has(h.phone))
    .map((h) => ({ id: stableId("contact", h.category, h.name_en), ...h }));
  return [...contacts, ...missing];
}

/**
 * §3.8: optional category matches HelpContact.category or Business.category. Inactive businesses are never
 * returned. Contacts: category, sort_order, name_en. Businesses: name only (sponsorship never changes order).
 */
export function filterHelp(
  contacts: readonly HelpContact[],
  businesses: readonly Business[],
  category?: string | null,
): HelpResponse {
  const cat = category?.trim() || null;
  return {
    contacts: withHotlines(contacts)
      .filter((c) => !cat || c.category === cat)
      .sort((a, b) => cmp(a.category, b.category) || a.sort_order - b.sort_order || cmp(a.name_en, b.name_en)),
    businesses: businesses
      .filter((b) => b.is_active && (!cat || b.category === cat))
      .sort((a, b) => cmp(a.name, b.name)),
  };
}
