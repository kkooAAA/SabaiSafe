// Pure helpers for the "I was quoted X" check (unit-tested by qa). No React.
import { PRICE_UNITS, type PriceUnit } from "@/types/protocol";
import type { PriceRef } from "@/types/api";
import type { PriceVerdict } from "@/types/price-verdict";

export const MAX_QUOTED = 10_000_000;

/**
 * Parses the quoted-price field (contracts §3.7): "" → null (no price given), "1,200" / "1 200.50" → number.
 * Returns "invalid" for anything that is not a positive number ≤ MAX_QUOTED (never send 0 or "").
 */
export function parseQuoted(input: string): number | null | "invalid" {
  // NFKC turns full-width digits/commas from a Chinese IME ("１，２００") into ASCII.
  const s = input
    .normalize("NFKC")
    .replace(/[,\s]/g, "")
    .replace(/^฿/, "")
    .replace(/(thb|baht|บาท|泰铢|铢)$/i, "");
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return "invalid";
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= MAX_QUOTED ? n : "invalid";
}

/** Units present in rows, in PRICE_UNITS order (the first one is the default, matching selectRefs). */
export function unitsOf(rows: readonly PriceRef[]): PriceUnit[] {
  const present = new Set(rows.map((r) => r.unit));
  return PRICE_UNITS.filter((u) => present.has(u));
}

export type VerdictKey = "within" | "above" | "far_above" | "no_quote" | "no_data";

/** messages key for a PriceVerdict (price.verdict.<key>). */
export const VERDICT_KEY: Record<PriceVerdict, VerdictKey> = {
  "Within normal range": "within",
  "Above typical range": "above",
  "Far above typical range": "far_above",
  "No price quoted": "no_quote",
  "Not enough data": "no_data",
};

/** True when the input names another currency (元/¥/RMB/CNY/$/USD…): show "enter the price in baht", never convert. */
export function looksLikeOtherCurrency(input: string): boolean {
  return /[元¥$€£]|rmb|cny|usd|eur|yuan|人民币|美元/i.test(input.normalize("NFKC"));
}
