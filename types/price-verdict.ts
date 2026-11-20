// Fair Price verdict rule: ONE shared copy for the UI badge (frontend) and the AI pipeline (lib/ai/price.ts).
// Pure: no server imports, safe in client components. Added by ai; changes need ai + frontend agreement.
// protocol.ts has no zod, and the api import is type-only, so the client bundle doesn't pull in zod.
import { PRICE_UNITS, type PriceUnit } from "./protocol";
import type { PriceRef } from "./api";

export type PriceVerdict =
  | "Within normal range"
  | "Above typical range"
  | "Far above typical range"
  | "No price quoted" // reference rows exist but the user gave no price
  | "Not enough data"; // no reference rows

/** Same rule as fairPriceSystem in lib/ai/prompts.ts: "Far above" = more than 1.5x the reference maximum. */
export const FAR_ABOVE_FACTOR = 1.5;

export const VERDICT_ZH: Record<PriceVerdict, string> = {
  "Within normal range": "在正常范围内",
  "Above typical range": "高于常见范围",
  "Far above typical range": "远高于常见范围",
  "No price quoted": "未提供报价",
  "Not enough data": "数据不足",
};

/**
 * Picks the references one quote can be compared with, so units are never mixed
 * (a per-day quote must not be judged against a per-week range). Contracts §3.7:
 * 1. if `unit` is given, keep only rows of that unit (none left => [] => "Not enough data");
 * 2. if an area is given and some rows are for that area (not island-wide "Phuket"), use only those;
 * 3. if units are still mixed, keep the first unit in PRICE_UNITS order (deterministic, not row order).
 */
export function selectRefs(refs: PriceRef[], area?: string | null, unit?: PriceUnit | null): PriceRef[] {
  let pool = unit ? refs.filter((r) => r.unit === unit) : refs;
  const a = area?.trim().toLowerCase();
  if (a) {
    const local = pool.filter((r) => r.area.toLowerCase().includes(a) && r.area.toLowerCase() !== "phuket");
    if (local.length) pool = local;
  }
  const chosen = PRICE_UNITS.find((u) => pool.some((r) => r.unit === u));
  return chosen === undefined ? [] : pool.filter((r) => r.unit === chosen);
}

/** Verdict from reference maxima (the highest max wins, so it is never harsher than the most generous ref). */
export function computeVerdict(quoted: number | null, refMaxima: number[]): PriceVerdict {
  if (refMaxima.length === 0) return "Not enough data";
  if (quoted === null) return "No price quoted";
  const max = Math.max(...refMaxima);
  if (quoted > max * FAR_ABOVE_FACTOR) return "Far above typical range";
  if (quoted > max) return "Above typical range";
  return "Within normal range";
}

/** What the UI badge should show for rows from GET /api/price (same item + area as the explain call). */
export function verdictFor(
  refs: PriceRef[],
  quoted: number | null,
  area?: string | null,
  unit?: PriceUnit | null,
): PriceVerdict {
  return computeVerdict(
    quoted,
    selectRefs(refs, area, unit).map((r) => r.max_thb),
  );
}
