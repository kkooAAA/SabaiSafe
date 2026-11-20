// PII scrubbing for report data (PDPA, contracts §2.6 / §3.3).
// Pure module with NO imports: used by lib/ai/report.ts, /api/report/save and backend's saveReport.
//
// Policy: redact number-like tokens and email addresses only. Words around them stay, so a key fact such as
// "they kept my passport as deposit" survives. Hotlines (1155 / 191 / 1669 / 1166) and
// money amounts ("5,000 baht", "50000 THB") are never touched.
// Thai digits (๐-๙) and full-width digits (０-９) are matched as if they were ASCII digits; the text that is
// not redacted is returned exactly as given.

export const REDACTED = "[REDACTED]";

/** Passport-like token anywhere: 1-2 letters, optional space, 6-9 digits (e.g. AB1234567, AB 1234567, E12345678). */
const PASSPORT_TOKEN = /\b[A-Z]{1,2} ?\d{6,9}\b/gi;

/**
 * Token right after a passport keyword, optionally with "no." / "number" / "#" / ":" in between.
 * The token is only redacted if it contains a digit ("passport deposit" stays). It may contain single spaces
 * between digit groups ("E 1234 5678"); a spaced token needs >= 6 digits, so "passport 30000 baht" stays.
 */
const PASSPORT_KEYWORD =
  /(passport|护照|หนังสือเดินทาง)((?:\s*(?:no\.?|number|num\.?|#|号码|号|เลขที่|เลข))?(?:\s*(?:is|was|是|为|คือ))?\s*[:：#]?\s*)([A-Z]{0,2} ?\d(?:[ -]?\d){5,13}|[A-Z0-9][A-Z0-9-]{5,14})/gi;

/** Separators allowed inside a phone number: space, dash, dot. */
const SEP = String.raw`[\s.-]?`;

/** Thai mobile: 06x/08x/09x + 7 digits; optional +66 / 0066 / 66 prefix; "(081)" style brackets allowed. */
const THAI_MOBILE = new RegExp(
  String.raw`(?<![\d+])\(?(?:(?:\+|00)?66${SEP}|0)[689]\d\)?(?:${SEP}\d){7}(?!\d)`,
  "g",
);

/** Thai landline: 0 + area code 2-7 + 7 more digits (e.g. 076-123-456, 02 123 4567, (076) 123 456). */
const THAI_LANDLINE = new RegExp(String.raw`(?<![\d+])\(?0[2-7]\)?(?:${SEP}\d){7}(?!\d)`, "g");

/** International: "+" or "00" + country code, followed by >= 8 digits (spaces/dashes/dots allowed). */
const INTL_PHONE = new RegExp(String.raw`(?:\+|(?<![\d.,])00)\d{1,3}(?:${SEP}\d){8,13}(?!\d)`, "g");

/** Chinese mobile without +86: 1[3-9] + 9 digits (e.g. 13800138000, 138 0013 8000). */
const CN_MOBILE = new RegExp(String.raw`(?<![\d+])1[3-9]\d(?:${SEP}\d){8}(?!\d)`, "g");

/** Email address (ASCII local part incl. +tags and dots). Stops at CJK/Thai text around it. */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;

/** Thai and full-width digits → ASCII. Each is one UTF-16 unit, so indices stay the same. */
function asciiDigits(s: string): string {
  return s.replace(/[๐-๙０-９]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= 0xff10 ? code - 0xff10 : code - 0x0e50);
  });
}

type Replacer = (match: string, ...groups: string[]) => string;

/**
 * Runs `re` on the ASCII-digit view of `s` and splices replacements into the ORIGINAL text, so text that isn't
 * redacted keeps its own digits. A replacer that returns the match unchanged keeps the original slice.
 */
function redact(s: string, re: RegExp, replacer: Replacer = () => REDACTED): string {
  const view = asciiDigits(s);
  let out = "";
  let last = 0;
  for (const m of view.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;
    const rep = replacer(m[0], ...(m.slice(1) as string[]));
    out += s.slice(last, start) + (rep === m[0] ? s.slice(start, end) : rep);
    last = end;
  }
  return out + s.slice(last);
}

export function scrubPassport(s: string): string {
  const keyword = redact(s, PASSPORT_KEYWORD, (all, word, sep, token) =>
    /\d/.test(token!) ? `${word}${sep}${REDACTED}` : all,
  );
  return redact(keyword, PASSPORT_TOKEN);
}

export function scrubPhone(s: string): string {
  let out = s;
  for (const re of [INTL_PHONE, THAI_MOBILE, THAI_LANDLINE, CN_MOBILE]) out = redact(out, re);
  return out;
}

export function scrubEmail(s: string): string {
  return s.replace(EMAIL, REDACTED);
}

/** Emails, passport numbers and phone numbers. Email first, so digits inside an address aren't half-redacted. */
export function scrubPII(s: string): string {
  return scrubPhone(scrubPassport(scrubEmail(s)));
}

/** Applies scrubPII to every string inside arrays / plain objects. Returns a new value. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === "string") return scrubPII(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => scrubDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v);
    return out as T;
  }
  return value;
}
