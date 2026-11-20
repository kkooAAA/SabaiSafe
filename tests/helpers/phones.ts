// Shared "invented phone number" detector, used by tests and evals/run.ts.
// A phone-like token is a run of digits joined by spaces, dashes, dots or parentheses, optionally
// starting with "+", that contains at least 6 digits. Amounts with thousands commas ("5,000"),
// short codes (1155) and ISO dates (2026-11-15) are not phone-like.
import { HOTLINE_NUMBERS } from "@/lib/hotlines";

const PHONE_LIKE = /\+?\(?\d[\d\s().-]{4,}\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_PREFIX = /^\d{4}-\d{2}-\d{2}[ T]?\d{0,2}/;

export function digitsOf(s: string) {
  return s.replace(/\D/g, "");
}

/** Returns phone-like tokens found in `text`, normalized to digits. */
export function findPhoneLike(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PHONE_LIKE)) {
    const raw = m[0].trim();
    if (ISO_DATE.test(raw) || ISO_DATETIME_PREFIX.test(raw)) continue;
    const d = digitsOf(raw);
    if (d.length < 6) continue;
    // "B.E. 2522 (1979)", "2025 2026": only year-like 4-digit groups ⇒ not a phone.
    const groups = raw.match(/\d+/g) ?? [];
    if (groups.every((g) => g.length === 4 && /^(19|20|24|25|26)\d\d$/.test(g))) continue;
    out.push(d);
  }
  return out;
}

/**
 * Phone-like numbers in `text` that are neither a hotline nor present in `allowed`
 * (e.g. numbers that appear verbatim in the sources given to the model).
 */
export function inventedNumbers(text: string, allowed: string[] = []): string[] {
  const ok = new Set([...HOTLINE_NUMBERS, ...allowed.flatMap((a) => findPhoneLike(a)), ...allowed.map(digitsOf)]);
  return findPhoneLike(text).filter((d) => !ok.has(d));
}
