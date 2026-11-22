// Pure scoring for the Legal Guide eval (contracts §7). No I/O; used by evals/run.ts and tests/evals.test.ts.
import { DISCLAIMER } from "@/lib/ai/prompts";
import type { ChatTrailer, UiLang } from "@/types/api";
import { ERROR_MARKER, SOURCES_DELIMITER } from "@/types/protocol";
import { inventedNumbers } from "@/tests/helpers/phones";

export type EvalQuestion = {
  id: string;
  lang: UiLang;
  question: string;
  /** Any one of these slugs in the trailer sources counts as a retrieval hit. Empty for out-of-scope questions. */
  expected_slugs: string[];
  /** Out-of-scope: the pipeline must take the no-answer path (no answer model call, fixed message). */
  expect_no_answer?: boolean;
  expect_emergency?: boolean;
};

export type ParsedStream = {
  answer: string;
  trailer: ChatTrailer | null;
  complete: boolean; // delimiter present and no ERROR_MARKER
  error: boolean; // ERROR_MARKER present
  trailerValid: boolean;
};

/** Split a /api/chat body per contracts §3.1. */
export function parseChatStream(body: string): ParsedStream {
  const errAt = body.indexOf(ERROR_MARKER);
  const delimAt = body.indexOf(SOURCES_DELIMITER);
  if (errAt !== -1 && (delimAt === -1 || errAt < delimAt)) {
    return { answer: body.slice(0, errAt), trailer: null, complete: false, error: true, trailerValid: false };
  }
  if (delimAt === -1) return { answer: body, trailer: null, complete: false, error: false, trailerValid: false };
  const answer = body.slice(0, delimAt);
  const rest = body.slice(delimAt + SOURCES_DELIMITER.length).trim();
  let trailer: ChatTrailer | null = null;
  try {
    const t = JSON.parse(rest) as ChatTrailer;
    if (t && Array.isArray(t.sources) && t.meta && typeof t.meta.no_answer === "boolean") trailer = t;
  } catch {
    trailer = null;
  }
  return { answer, trailer, complete: true, error: false, trailerValid: trailer !== null };
}

const CJK = /[㐀-鿿豈-﫿]/g;
const LATIN = /[A-Za-z]/g;

/**
 * Language check on the answer prose (citations, numbers, law names in Thai and the "TO VERIFY" marker are ignored).
 * zh: CJK characters make up at least half of the CJK+Latin letters. en: almost no CJK.
 */
export function languageOk(answer: string, lang: UiLang): boolean {
  const prose = answer.replace(/TO VERIFY/g, "").replace(/\[\d+\]/g, "").replace(/B\.E\./g, "");
  const cjk = (prose.match(CJK) ?? []).length;
  const latin = (prose.match(LATIN) ?? []).length;
  if (cjk + latin === 0) return false;
  return lang === "zh" ? cjk / (cjk + latin) >= 0.5 : cjk / (cjk + latin) <= 0.02;
}

/** Citation numbers [n] used in the answer. */
export function citationsIn(answer: string): number[] {
  return [...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
}

export type QuestionScore = {
  id: string;
  lang: UiLang;
  status: number;
  complete: boolean;
  trailer_valid: boolean;
  no_answer: boolean;
  /** null when not applicable (out-of-scope question). */
  hit: boolean | null;
  /** Rank (1-based) of the first expected slug in the sources, null if missing / n.a. */
  hit_rank: number | null;
  no_answer_ok: boolean | null; // OOS question took the no-answer path
  disclaimer: boolean;
  /** Answered question: at least one [n], and every [n] is a source id. n.a. on the no-answer path. */
  citations: boolean | null;
  invented_numbers: string[];
  language: boolean;
  emergency_ok: boolean | null;
  source_slugs: string[];
  draft_sources: number;
  /** Highest source similarity in the trailer (null when no sources). */
  top_similarity: number | null;
  /** Model planning/thinking text that leaked into the answer (heuristic; reported, not a gate). */
  thinking_leak: string[];
  /** The answer prose (before the sources delimiter), kept for human review. */
  answer: string;
  /** Chat model that answered: the primary, or its fallback if lib/ai/fallback.ts switched. null in --url mode. */
  model_used: string | null;
  failures: string[];
};

const FALLBACK_LOG = /^\[ai\] (\S+) failed \(.*\); falling back to (\S+)\s*$/;

/**
 * Chat model that answered one question, from the primary chat model id and the warnings logged while it ran
 * (lib/ai/fallback.ts logs "[ai] <primary> failed (...); falling back to <fallback>"). A fallback of another
 * model (e.g. the fast model) doesn't change the answer model. null when the primary is unknown (--url mode).
 */
export function modelUsed(primaryId: string | null, logs: readonly string[]): string | null {
  if (!primaryId) return null;
  for (const line of logs) {
    const m = FALLBACK_LOG.exec(line);
    if (m && m[1] === primaryId) return m[2]!;
  }
  return primaryId;
}

/** Lines that look like model planning rather than an answer to the tourist (seen once on Gemini). */
const LEAK_PATTERNS: RegExp[] = [
  /^\s*(okay|ok|alright|so)[,.]?\s+(let me|let's|i (need|will|should))\b/im,
  /^\s*(let me|i need to|i will now|i should)\s+(think|check|look|plan|draft|structure|answer|write|figure)/im,
  /\bthe user (is asking|asks|wants|question)\b/i,
  /^\s*(\*\*)?(thinking|thought|plan|planning|draft|step \d+)(\*\*)?\s*:/im,
  /<\/?(think|thinking|thought)>/i,
  /用户(问|想|询问|的问题)/,
  /(我需要|让我)(先)?(思考|检查|规划|组织|起草)/,
];
export function thinkingLeaks(answer: string): string[] {
  return LEAK_PATTERNS.filter((r) => r.test(answer)).map((r) => (answer.match(r)?.[0] ?? "").trim().slice(0, 60));
}

export function scoreAnswer(q: EvalQuestion, status: number, body: string): QuestionScore {
  const p = parseChatStream(body);
  const sources = p.trailer?.sources ?? [];
  const slugs = sources.map((s) => s.doc_slug);
  const noAnswer = p.trailer?.meta.no_answer ?? false;
  const inScope = !q.expect_no_answer;

  const rankIdx = inScope ? slugs.findIndex((s) => q.expected_slugs.includes(s)) : -1;
  const hit = inScope ? rankIdx !== -1 : null;
  const ids = new Set(sources.map((s) => s.id));
  const cites = citationsIn(p.answer);
  const citations = noAnswer ? null : cites.length > 0 && cites.every((n) => ids.has(n));
  const allowed = sources.map((s) => s.excerpt);
  const invented = inventedNumbers(p.answer, allowed);

  const s: QuestionScore = {
    id: q.id,
    lang: q.lang,
    status,
    complete: p.complete,
    trailer_valid: p.trailerValid,
    no_answer: noAnswer,
    hit,
    hit_rank: rankIdx === -1 ? null : rankIdx + 1,
    no_answer_ok: q.expect_no_answer ? noAnswer : null,
    disclaimer: p.answer.includes(DISCLAIMER[q.lang]),
    citations,
    invented_numbers: invented,
    language: languageOk(p.answer, q.lang),
    emergency_ok: q.expect_emergency ? p.trailer?.meta.is_emergency === true : null,
    source_slugs: slugs,
    draft_sources: sources.filter((x) => x.status === "DRAFT").length,
    top_similarity: sources.length ? Math.max(...sources.map((x) => x.similarity)) : null,
    thinking_leak: thinkingLeaks(p.answer),
    answer: p.answer,
    model_used: null,
    failures: [],
  };
  const f = s.failures;
  if (status !== 200) f.push(`http ${status}`);
  if (!s.complete) f.push(p.error ? "stream error" : "incomplete stream");
  else if (!s.trailer_valid) f.push("bad trailer");
  if (s.hit === false) f.push(noAnswer ? "no-answer on in-scope question" : `miss (got ${slugs.join(",") || "none"})`);
  if (s.no_answer_ok === false) f.push("out-of-scope question was answered");
  if (!s.disclaimer) f.push("no disclaimer");
  if (s.citations === false) f.push("bad/missing citations");
  if (invented.length) f.push(`invented numbers ${invented.join(",")}`);
  if (!s.language) f.push("wrong language");
  if (s.emergency_ok === false) f.push("emergency not flagged");
  return s;
}

export type Summary = {
  total: number;
  in_scope: number;
  hit_rate: number; // in-scope questions with an expected slug in sources
  mrr: number;
  no_answer_rate_in_scope: number;
  oos_no_answer_rate: number; // out-of-scope questions correctly refused
  disclaimer_rate: number;
  citation_rate: number; // over answered questions
  invented_number_answers: number;
  language_rate: number;
  emergency_rate: number | null;
  complete_rate: number;
  by_lang: Record<UiLang, { total: number; hit_rate: number }>;
};

const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 1);

export function summarize(scores: QuestionScore[]): Summary {
  const inScope = scores.filter((s) => s.hit !== null);
  const oos = scores.filter((s) => s.no_answer_ok !== null);
  const answered = scores.filter((s) => s.citations !== null);
  const emerg = scores.filter((s) => s.emergency_ok !== null);
  const byLang = (lang: UiLang) => {
    const xs = inScope.filter((s) => s.lang === lang);
    return { total: scores.filter((s) => s.lang === lang).length, hit_rate: rate(xs.map((s) => s.hit === true)) };
  };
  return {
    total: scores.length,
    in_scope: inScope.length,
    hit_rate: rate(inScope.map((s) => s.hit === true)),
    mrr: inScope.length ? inScope.reduce((n, s) => n + (s.hit_rank ? 1 / s.hit_rank : 0), 0) / inScope.length : 1,
    no_answer_rate_in_scope: rate(inScope.map((s) => s.no_answer)),
    oos_no_answer_rate: rate(oos.map((s) => s.no_answer_ok === true)),
    disclaimer_rate: rate(scores.map((s) => s.disclaimer)),
    citation_rate: rate(answered.map((s) => s.citations === true)),
    invented_number_answers: scores.filter((s) => s.invented_numbers.length > 0).length,
    language_rate: rate(scores.map((s) => s.language)),
    emergency_rate: emerg.length ? rate(emerg.map((s) => s.emergency_ok === true)) : null,
    complete_rate: rate(scores.map((s) => s.complete && s.trailer_valid)),
    by_lang: { en: byLang("en"), zh: byLang("zh") },
  };
}

/** Hard gates that must hold in every mode (mock or real). Retrieval gates are applied by run.ts in real mode. */
export function hardFailures(sum: Summary): string[] {
  const out: string[] = [];
  if (sum.complete_rate < 1) out.push(`complete_rate ${sum.complete_rate.toFixed(2)} < 1`);
  if (sum.disclaimer_rate < 1) out.push(`disclaimer_rate ${sum.disclaimer_rate.toFixed(2)} < 1`);
  if (sum.invented_number_answers > 0) out.push(`${sum.invented_number_answers} answers with invented numbers`);
  if (sum.language_rate < 1) out.push(`language_rate ${sum.language_rate.toFixed(2)} < 1`);
  if (sum.citation_rate < 1) out.push(`citation_rate ${sum.citation_rate.toFixed(2)} < 1`);
  return out;
}
