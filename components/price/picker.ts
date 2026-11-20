// Pure helpers for the Fair Price picker (unit-tested by qa). No React.
import type { PriceCategory, PriceRef, UiLang } from "@/types/api";
import { pickLang } from "@/components/shared/format";

/** Island-wide rows always apply to every area (contracts §3.6). */
export const ISLAND_WIDE_AREA = "Phuket";

export const CATEGORY_ORDER: readonly PriceCategory[] = [
  "transport",
  "rental",
  "activity",
  "food",
  "accommodation",
  "other",
];

export type ItemOption = { key: string; label: string; category: PriceCategory };
export type ItemGroup = { category: PriceCategory; items: ItemOption[] };

/** Distinct items by item_key, grouped by category (fixed order), labels sorted per locale. */
export function buildItemGroups(rows: readonly PriceRef[], lang: UiLang): ItemGroup[] {
  const byKey = new Map<string, ItemOption>();
  for (const r of rows) {
    if (!byKey.has(r.item_key)) {
      byKey.set(r.item_key, { key: r.item_key, label: pickLang(lang, r.item_name_en, r.item_name_zh), category: r.category });
    }
  }
  const collator = new Intl.Collator(lang === "zh" ? "zh-CN" : "en");
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: [...byKey.values()].filter((i) => i.category === category).sort((a, b) => collator.compare(a.label, b.label)),
  })).filter((g) => g.items.length > 0);
}

/** Distinct areas, island-wide first, then alphabetical. */
export function buildAreas(rows: readonly PriceRef[]): string[] {
  const areas = [...new Set(rows.map((r) => r.area))];
  return areas.sort((a, b) => {
    if (a === ISLAND_WIDE_AREA) return -1;
    if (b === ISLAND_WIDE_AREA) return 1;
    return a.localeCompare(b, "en");
  });
}

/** item/area null = no filter. Island-wide rows are included for any area. Input order preserved. */
export function filterPrices(rows: readonly PriceRef[], item: string | null, area: string | null): PriceRef[] {
  return rows.filter(
    (r) => (!item || r.item_key === item) && (!area || r.area === area || r.area === ISLAND_WIDE_AREA),
  );
}

/** Display order: CATEGORY_ORDER, then localized item name, then island-wide first, then area. Returns a copy. */
export function sortPrices(rows: readonly PriceRef[], lang: UiLang): PriceRef[] {
  const collator = new Intl.Collator(lang === "zh" ? "zh-CN" : "en");
  const rank = (c: PriceCategory) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const areaRank = (a: string) => (a === ISLAND_WIDE_AREA ? 0 : 1);
  return [...rows].sort(
    (a, b) =>
      rank(a.category) - rank(b.category) ||
      collator.compare(pickLang(lang, a.item_name_en, a.item_name_zh), pickLang(lang, b.item_name_en, b.item_name_zh)) ||
      areaRank(a.area) - areaRank(b.area) ||
      a.area.localeCompare(b.area, "en"),
  );
}
