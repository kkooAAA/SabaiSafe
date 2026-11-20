// Legal Guide RAG pipeline (contracts §3.1):
//   scrub PII → query rewrite (FAST, QUERY_REWRITE_SYSTEM) → embed search_query → match_legal(emb, 6, lang)
//   → drop rows under LEGAL_MIN_SIMILARITY → legalGuideSystem + legalGuideUser → stream + SOURCES trailer.
// No passing source ⇒ the answer model is NOT called; NO_ANSWER_MESSAGE is streamed with no_answer: true.
// Sample mode (no Supabase) searches content/legal in memory (legal-index.ts) instead of the RPC.
import { generateText, streamText } from "ai";
import { z } from "zod";
import type { ChatRequest, ChatTrailer, LegalSource, LegalTopic, UiLang } from "@/types/api";
import type { LegalMatchRow } from "@/types/db";
import { isSampleMode } from "@/lib/db/client";
import { matchLegal } from "@/lib/db/legal";
import { guardAnswer } from "./answer-guard";
import { DISCLAIMER, EMERGENCY_HINT_RE, NO_ANSWER_MESSAGE, minSimilarity } from "./constants";
import { LEGAL_TOPICS, excerptOf } from "./legal-content";
import { matchSample } from "./legal-index";
import { MOCK_TRIGGERS } from "./mock-fixtures";
import { QUERY_REWRITE_SYSTEM, legalGuideSystem, legalGuideUser } from "./prompts";
import { AiUnavailableError, chatModel, embed, embeddingModelId, fastModel, isMock, requireEmbeddingKey, modelCallOptions } from "./provider";
import { scrubPII } from "./scrub";
import { fixedText, textDeltas, textStreamResponse, primeDeltas } from "./stream";

/** Rows asked from match_legal per search (contracts §3.1) and the most sources given to the model. */
export const MATCH_COUNT = 6;
export const MAX_SOURCES = 6;

export type QueryRewrite = {
  search_query: string;
  location: string | null;
  topic: LegalTopic;
  is_emergency: boolean;
};

const RewriteSchema = z.object({
  search_query: z.string().trim().min(1).max(500),
  location: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  topic: z.enum(LEGAL_TOPICS).catch("other"),
  is_emergency: z.boolean().catch(false),
});

/** Parses the rewriter's reply (tolerates ```json fences and prose around the object). null if unusable. */
export function parseRewrite(text: string): QueryRewrite | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = RewriteSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Used when the rewriter fails or returns junk: search with the question itself. */
export function fallbackRewrite(question: string): QueryRewrite {
  return { search_query: question, location: null, topic: "other", is_emergency: EMERGENCY_HINT_RE.test(question) };
}

export async function rewriteQuery(question: string, signal?: AbortSignal): Promise<QueryRewrite> {
  const model = fastModel();
  try {
    const { text } = await generateText({
      ...modelCallOptions(),
      model,
      system: QUERY_REWRITE_SYSTEM,
      prompt: question,
      temperature: 0,
      maxOutputTokens: 200,
      abortSignal: signal,
    });
    return parseRewrite(text) ?? fallbackRewrite(question);
  } catch (err) {
    if (err instanceof AiUnavailableError || signal?.aborted) throw err;
    console.error("[legal] query rewrite failed, using the question as the query", err);
    return fallbackRewrite(question);
  }
}

async function search(embedding: number[], lang: UiLang | null): Promise<LegalMatchRow[]> {
  return isSampleMode() ? matchSample(embedding, MATCH_COUNT, lang) : matchLegal(embedding, MATCH_COUNT, lang);
}

/**
 * en: search en only. zh: search zh and all languages, merge (§3.1 "prefers zh").
 * Note: match_legal with lang=null returns every language, so en rows can appear for zh questions.
 */
export async function retrieve(embedding: number[], lang: UiLang): Promise<LegalMatchRow[]> {
  if (lang === "en") return search(embedding, "en");
  const [zh, all] = await Promise.all([search(embedding, "zh"), search(embedding, null)]);
  return [...zh, ...all];
}

/**
 * Threshold, dedupe and rank (pure). Rows under `min` are dropped. For zh: a non-zh chunk is dropped when the zh
 * version of the same document is among the results, and zh rows rank before others. Max MAX_SOURCES.
 */
export function selectSources(rows: LegalMatchRow[], lang: UiLang, min: number): LegalMatchRow[] {
  const byId = new Map<number, LegalMatchRow>();
  for (const r of rows) {
    if (!(r.similarity >= min)) continue;
    const prev = byId.get(r.id);
    if (!prev || r.similarity > prev.similarity) byId.set(r.id, r);
  }
  let kept = [...byId.values()];
  const rank = (r: LegalMatchRow) => (r.lang === lang ? 0 : 1);
  if (lang !== "en") {
    const preferred = new Set(kept.filter((r) => r.lang === lang).map((r) => r.doc_slug));
    kept = kept.filter((r) => r.lang === lang || !preferred.has(r.doc_slug));
  }
  kept.sort((a, b) => rank(a) - rank(b) || b.similarity - a.similarity || a.id - b.id);
  return kept.slice(0, MAX_SOURCES);
}

/** Trailer entry for each source given to the model; `id` is the citation number. */
export function toLegalSources(rows: LegalMatchRow[]): LegalSource[] {
  return rows.map((r, i) => ({
    id: i + 1,
    chunk_id: r.id,
    doc_slug: r.doc_slug,
    title: r.title,
    law: r.law,
    law_th: r.law_th,
    section: r.section,
    location: r.location,
    source_url: r.source_url,
    status: r.status,
    similarity: Math.round(r.similarity * 1000) / 1000,
    excerpt: excerptOf(r.content),
  }));
}

/** Shape legalGuideUser expects. Section "TO VERIFY" is dropped by the prompt itself, never shown as a number. */
export function toPromptSources(rows: LegalMatchRow[]) {
  return rows.map((r, i) => ({
    id: i + 1,
    title: r.title,
    law: r.law,
    section: r.section ?? undefined,
    url: r.source_url ?? undefined,
    content: r.content,
  }));
}

/** Runs the pipeline. Errors before streaming starts (missing key, DB) are thrown to the route. */
export async function answerLegal(req: ChatRequest, signal?: AbortSignal): Promise<Response> {
  const lang = req.lang;
  // Check every key up front so a missing one is a clean 503, not a broken stream.
  const answerModel = chatModel();
  fastModel();
  requireEmbeddingKey();

  const question = scrubPII(req.question);
  const rewrite = await rewriteQuery(question, signal);

  const skipRetrieval = isMock() && question.includes(MOCK_TRIGGERS.noAnswer);
  const rows = skipRetrieval ? [] : await retrieve(await embed(rewrite.search_query, { task: "query" }), lang);
  const chosen = selectSources(rows, lang, minSimilarity(embeddingModelId()));

  const meta = { is_emergency: rewrite.is_emergency, topic: rewrite.topic, location: rewrite.location };

  if (chosen.length === 0) {
    const trailer: ChatTrailer = { sources: [], meta: { ...meta, no_answer: true } };
    return textStreamResponse(fixedText(NO_ANSWER_MESSAGE[lang]), { trailer: () => trailer });
  }

  const trailer: ChatTrailer = { sources: toLegalSources(chosen), meta: { ...meta, no_answer: false } };
  const result = streamText({
    ...modelCallOptions(),
    model: answerModel,
    system: legalGuideSystem(lang),
    prompt: legalGuideUser(question, toPromptSources(chosen)),
    temperature: 0.2,
    maxOutputTokens: 900,
    abortSignal: signal,
  });
  return textStreamResponse(guardAnswer(await primeDeltas(textDeltas(result.stream)), DISCLAIMER[lang]), {
    trailer: () => trailer,
    onError: (err) => console.error("[/api/chat] stream failed", err),
  });
}
