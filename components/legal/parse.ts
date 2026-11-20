// Pure helpers for the Legal Guide stream (contracts §3.1). No React, no fetch: unit-testable.
import { ERROR_MARKER, SOURCES_DELIMITER } from "@/types/protocol";
import type { ChatTrailer, ContentStatus, LegalSource, LegalTopic } from "@/types/api";

/** Both protocol markers start with this; clients render only text before its first occurrence. */
const MARKER_START = "\n\u001e";

export type LegalStreamState =
  /** Still receiving (answer text may grow, or the trailer is pending). */
  | "streaming"
  /** Delimiter + valid trailer received. */
  | "complete"
  /** Delimiter received but the trailer JSON was invalid: show answer + disclaimer, no sources. */
  | "bad_trailer"
  /** Stream ended without the delimiter: the answer may be cut off. */
  | "incomplete"
  /** ERROR_MARKER received (the model failed mid-stream). */
  | "error";

export type LegalParse = { answer: string; trailer: ChatTrailer | null; state: LegalStreamState };

const TOPICS: readonly LegalTopic[] = [
  "scam",
  "price",
  "transport",
  "rental",
  "alcohol_drugs",
  "beach_rules",
  "accommodation",
  "police_procedure",
  "visa_immigration",
  "other",
];

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toSource(v: unknown): LegalSource | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = num(o.id);
  const title = str(o.title);
  if (id === null || !Number.isInteger(id) || id < 1 || !title) return null;
  // Anything that is not explicitly VERIFIED is shown as a draft (fail safe).
  const status: ContentStatus = o.status === "VERIFIED" ? "VERIFIED" : "DRAFT";
  return {
    id,
    chunk_id: num(o.chunk_id) ?? 0,
    doc_slug: str(o.doc_slug) ?? "",
    title,
    law: str(o.law) ?? "",
    law_th: str(o.law_th),
    section: str(o.section),
    location: str(o.location),
    source_url: str(o.source_url),
    status,
    similarity: num(o.similarity) ?? 0,
    excerpt: str(o.excerpt) ?? "",
  };
}

/** Parses the one-line trailer JSON. Returns null when it is not a ChatTrailer-shaped object. */
export function parseTrailer(raw: string): ChatTrailer | null {
  let v: unknown;
  try {
    v = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.sources)) return null;
  const seen = new Set<number>();
  const sources: LegalSource[] = [];
  for (const s of o.sources) {
    const src = toSource(s);
    if (src && !seen.has(src.id)) {
      seen.add(src.id);
      sources.push(src);
    }
  }
  const m = (o.meta && typeof o.meta === "object" ? o.meta : {}) as Record<string, unknown>;
  const topic = TOPICS.includes(m.topic as LegalTopic) ? (m.topic as LegalTopic) : "other";
  return {
    sources,
    meta: {
      is_emergency: m.is_emergency === true,
      no_answer: m.no_answer === true,
      topic,
      location: str(m.location),
    },
  };
}

/**
 * Splits a (possibly partial) /api/chat body into answer text and trailer.
 * `done` = the stream has ended. While streaming, a trailing "\n" is held back (it may start a marker).
 */
export function parseLegalStream(buf: string, done: boolean): LegalParse {
  const i = buf.indexOf(MARKER_START);
  if (i < 0) {
    if (done) return { answer: buf, trailer: null, state: "incomplete" };
    return { answer: buf.endsWith("\n") ? buf.slice(0, -1) : buf, trailer: null, state: "streaming" };
  }
  const answer = buf.slice(0, i);
  const rest = buf.slice(i);
  if (rest.startsWith(ERROR_MARKER)) return { answer, trailer: null, state: "error" };
  if (rest.startsWith(SOURCES_DELIMITER)) {
    const after = rest.slice(SOURCES_DELIMITER.length);
    if (after.includes(ERROR_MARKER)) return { answer, trailer: null, state: "error" };
    if (!done) return { answer, trailer: null, state: "streaming" };
    const trailer = parseTrailer(after);
    return trailer ? { answer, trailer, state: "complete" } : { answer, trailer: null, state: "bad_trailer" };
  }
  // A marker has started but is not complete yet (or is unknown).
  if (!done && (ERROR_MARKER.startsWith(rest) || SOURCES_DELIMITER.startsWith(rest))) {
    return { answer, trailer: null, state: "streaming" };
  }
  return { answer, trailer: null, state: done ? "incomplete" : "streaming" };
}

/**
 * Removes the fixed disclaimer line(s) from the end of the answer: the UI always shows its own copy.
 * Tolerates Markdown emphasis / blockquote around the line and trailing whitespace.
 */
export function stripDisclaimer(answer: string, disclaimers: readonly string[]): string {
  let out = answer;
  for (const d of disclaimers) {
    if (!d) continue;
    const at = out.lastIndexOf(d);
    if (at < 0) continue;
    const tail = out.slice(at + d.length);
    if (!/^[\s*_"“”]*$/.test(tail)) continue;
    const lineStart = out.lastIndexOf("\n", at - 1) + 1;
    if (!/^[\s>*_"“”-]*$/.test(out.slice(lineStart, at))) continue;
    out = out.slice(0, lineStart);
  }
  return out.replace(/\s+$/, "");
}

/** Anchor id of a source card, used by citation links. */
export const sourceAnchor = (id: number) => `src-${id}`;

// [1] / [1, 2] / [1，2] / [1、2]; not a Markdown link "[1](...)" or reference definition "[1]:".
const CITATION_RE = /\[(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)\](?![(:])/g;

/**
 * Turns citations into in-page links "[n](#src-n)" for ids present in the trailer; other numbers stay plain text.
 * Code spans and fenced code are left untouched.
 */
export function linkCitations(answer: string, ids: ReadonlySet<number>): string {
  if (ids.size === 0) return answer;
  return answer
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, idx) => {
      if (idx % 2 === 1) return part; // code
      return part.replace(CITATION_RE, (whole, list: string) => {
        const nums = list.split(/\s*[,，、]\s*/).map(Number);
        if (!nums.some((n) => ids.has(n))) return whole;
        return nums.map((n) => (ids.has(n) ? `[${n}](#${sourceAnchor(n)})` : `\\[${n}\\]`)).join("");
      });
    })
    .join("");
}

/** True for a section worth showing (not empty, not the "TO VERIFY" placeholder). */
export function showSection(section: string | null | undefined): section is string {
  return !!section && section.trim() !== "" && section.trim().toUpperCase() !== "TO VERIFY";
}

// Client-side hint so the emergency banner appears immediately, before the trailer arrives.
// The server's meta.is_emergency also turns it on. Broad on purpose: a false positive only shows hotlines.
const URGENT_RE =
  /\b(emergenc\w*|urgent|help me|sos|hurt|injur\w*|bleed\w*|attack\w*|assault\w*|rap(e|ed)|robb\w*|mugg\w*|stab\w*|kidnap\w*|threat\w*|danger\w*|accident|crash\w*|drown\w*|unconscious|overdose|police now|being followed|chasing me)\b|救命|紧急|急救|受伤|流血|危险|抢劫|被抢|袭击|被打|殴打|强奸|性侵|绑架|威胁|车祸|事故|溺水|昏迷|跟踪|报警/i;

export function looksUrgent(question: string): boolean {
  return URGENT_RE.test(question);
}
