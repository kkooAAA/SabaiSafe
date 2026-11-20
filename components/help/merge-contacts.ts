// Pure helper for the Help page (unit-tested by qa). No React.
import { HOTLINES, HOTLINE_NUMBERS } from "@/lib/hotlines";
import type { HelpCategory, HelpContact } from "@/types/api";

export type Hotline = (typeof HOTLINES)[number];

export type MergedHelp = {
  /** Always the four hotlines from lib/hotlines.ts, in that order. Never from the DB. */
  hotlines: readonly Hotline[];
  /** DB contacts minus any row that duplicates a hotline number, grouped by CATEGORY_ORDER (stable within a category). */
  contacts: HelpContact[];
  /** Categories present in `contacts`, in a fixed display order. */
  categories: HelpCategory[];
};

const CATEGORY_ORDER: readonly HelpCategory[] = [
  "police",
  "hospital",
  "embassy",
  "immigration",
  "consumer",
  "emergency",
  "other",
];

const normalize = (phone: string) => phone.replace(/\D/g, "");
const HOTLINE_SET = new Set(HOTLINE_NUMBERS.map(normalize));

export function isHotlineNumber(phone: string | null | undefined): boolean {
  return !!phone && HOTLINE_SET.has(normalize(phone));
}

/** `contacts` is null/undefined when the DB call failed: hotlines still come back. */
export function mergeContacts(contacts: readonly HelpContact[] | null | undefined): MergedHelp {
  const rank = (c: HelpCategory) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const rest = (contacts ?? [])
    .filter((c) => !isHotlineNumber(c.phone))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.category) - rank(b.c.category) || a.i - b.i)
    .map(({ c }) => c);
  const present = new Set(rest.map((c) => c.category));
  return {
    hotlines: HOTLINES,
    contacts: rest,
    categories: CATEGORY_ORDER.filter((c) => present.has(c)),
  };
}

export function filterByCategory(contacts: readonly HelpContact[], category: HelpCategory | null): HelpContact[] {
  return category ? contacts.filter((c) => c.category === category) : [...contacts];
}
