// Output guard for streamed legal answers (CLAUDE.md: the AI must never make up phone numbers).
// The prompt already forbids invented numbers; this is the belt-and-braces check in code:
//   1. phone-shaped numbers (Thai mobile/landline, Chinese mobile, +intl) are redacted via scrub.ts#scrubPhone;
//   2. a 3-6 digit short code right after a "call / dial / hotline / 拨打 / 电话 ..." word is redacted
//      unless it is one of the four hotlines (lib/hotlines.ts).
// It works on a stream: raw text is held back (at least HOLD chars) and only a prefix whose guarded form can no
// longer change is sent, so a number, or a "call ... <number>" pair, split across model chunks is checked whole.
import { HOTLINE_NUMBERS } from "@/lib/hotlines";
import { REDACTED, scrubPhone } from "./scrub";

/** Longest span a match can cover (keyword + gap + number), plus margin. */
const HOLD = 64;

const CALL_WORD = String.raw`(?:call(?:ing)?|dial(?:ling)?|phone|ring|hotline|helpline|tel\.?|拨打|致电|电话|热线|โทร)`;
/** Units that make a number an amount or a duration, not a phone code. */
const NOT_A_CODE = String.raw`(?!\s*(?:baht|thb|บาท|泰铢|铢|元|%|days?|hours?|minutes?|天|小时|分钟))`;
/** keyword, up to 30 chars without digits / line breaks / sentence ends, then a short code. */
const SHORT_CODE = new RegExp(
  String.raw`(${CALL_WORD}[^\d\n.。!?！？]{0,30}?)(?<![\d+])(\d{3,6})(?![\d,.]?\d)${NOT_A_CODE}`,
  "giu",
);

const HOTLINES = new Set(HOTLINE_NUMBERS);

/** Redacts phone-shaped numbers and non-hotline short codes after a "call" word. Pure; idempotent. */
export function guardNumbers(text: string): string {
  return scrubPhone(text).replace(SHORT_CODE, (all, lead: string, code: string) =>
    HOTLINES.has(code) ? all : `${lead}${REDACTED}`,
  );
}

const NUMERIC_CHAR = /[\d\s+\-().]/;

/**
 * Largest safe split point of `raw` that leaves at least HOLD characters held back: not inside a run of
 * number-ish characters or a surrogate pair, and guarding the two halves separately gives the same text as
 * guarding the whole (so no match crosses it). 0 if there is none yet.
 */
export function safeCut(raw: string): number {
  const whole = guardNumbers(raw);
  for (let cut = raw.length - HOLD; cut > 0; cut--) {
    if (NUMERIC_CHAR.test(raw[cut - 1]!) && NUMERIC_CHAR.test(raw[cut]!)) continue;
    if (/[\uD800-\uDBFF]/.test(raw[cut - 1]!)) continue;
    if (guardNumbers(raw.slice(0, cut)) + guardNumbers(raw.slice(cut)) === whole) return cut;
  }
  return 0;
}

/**
 * Streams `deltas` through guardNumbers. If `disclaimer` is given and the finished text does not contain it,
 * it is appended after a blank line (the UI shows it too, but the text should carry it on its own).
 * If `deltas` throws, the held-back text is sent (guarded) before the error is rethrown.
 */
export async function* guardAnswer(deltas: AsyncIterable<string>, disclaimer?: string): AsyncGenerator<string> {
  let raw = "";
  let sent = ""; // answers are short (< 250 words), so keeping all of it is cheap
  const emit = (s: string) => {
    sent += s;
    return s;
  };
  try {
    for await (const d of deltas) {
      raw += d;
      const cut = safeCut(raw);
      if (cut > 0) {
        yield emit(guardNumbers(raw.slice(0, cut)));
        raw = raw.slice(cut);
      }
    }
  } catch (err) {
    if (raw) yield emit(guardNumbers(raw));
    throw err;
  }
  if (raw) yield emit(guardNumbers(raw));
  if (disclaimer && !sent.includes(disclaimer)) {
    const sep = !sent.trim() || sent.endsWith("\n\n") ? "" : sent.endsWith("\n") ? "\n" : "\n\n";
    yield emit(sep + disclaimer);
  }
}
