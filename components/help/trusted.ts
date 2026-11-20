// Pure helpers for the Trusted Services list (contracts §2.4). No React: unit-testable by qa.
import { BUSINESS_CRITERIA } from "@/types/protocol";
import type { Business, BusinessCategory } from "@/types/api";

export const BUSINESS_CATEGORIES: readonly BusinessCategory[] = [
  "rental",
  "transport",
  "tour",
  "hotel",
  "restaurant",
  "shop",
  "other",
];

/**
 * Display order: by `name` (case- and accent-insensitive, the same for every UI language), then id.
 * Sponsorship NEVER changes the order (contracts §2.4); inactive businesses are dropped.
 */
export function orderBusinesses(list: readonly Business[]): Business[] {
  return list
    .filter((b) => b.is_active !== false)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** Categories present in the list, in BUSINESS_CATEGORIES order. */
export function businessCategories(list: readonly Business[]): BusinessCategory[] {
  const present = new Set(list.map((b) => b.category));
  return BUSINESS_CATEGORIES.filter((c) => present.has(c));
}

export function filterBusinesses(list: readonly Business[], category: BusinessCategory | null): Business[] {
  return category ? list.filter((b) => b.category === category) : [...list];
}

/** Known criteria keys the business meets, in BUSINESS_CRITERIA order, without duplicates or unknown keys. */
export function metCriteria(criteria: readonly string[]): string[] {
  const set = new Set(criteria);
  return BUSINESS_CRITERIA.filter((k) => set.has(k));
}
