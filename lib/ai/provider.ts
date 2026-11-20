// Model + embedding provider for all AI routes. Server-only (never import from client components).
//
// AI_PROVIDER = "anthropic" | "openai" | "google" | "mock" (unset => "anthropic").
//   - chat/fast models come from the chosen provider; override ids with AI_MODEL_CHAT / AI_MODEL_FAST.
//     Keys: ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY.
// EMBEDDING_PROVIDER = "openai" | "google" (unset => "google" when AI_PROVIDER=google, else "openai"; contracts v0.5).
//   - openai: text-embedding-3-small (1536 dims). google: gemini-embedding-001 with outputDimensionality 1536,
//     taskType RETRIEVAL_DOCUMENT (ingest, sample index) or RETRIEVAL_QUERY (questions). Reduced-dimension Gemini
//     vectors are not unit length, so they are L2-normalized here (all vectors this module returns are unit length).
//   - embeddingModelId() names the vector space; ingest folds it into content_hash so a switch re-embeds everything.
//   - AI_PROVIDER=mock always uses the mock embedding. A missing key throws AiUnavailableError (routes map it to 503).
//
// ---------------------------------------------------------------------------------------------
// MOCK MODE (AI_PROVIDER=mock): deterministic, no network. Used by tests and CI.
// The mock is a real LanguageModelV4 (ai/test), so the route code paths run unchanged.
// It recognises which prompt it was given by comparing the system prompt with lib/ai/prompts.ts:
//   - query rewrite  -> JSON; is_emergency = MOCK_EMERGENCY_RE; topic from keywords; location
//                       "Patong Beach" if the text mentions Patong.
//   - legal answer   -> text citing [1] and [2], ending with the fixed DISCLAIMER for the language.
//   - interview      -> if the last user message matches MOCK_CONFIRM_RE (yes / correct / 是 / 对 / 没错):
//                       "Thank you for confirming. ..." ending in "\n[READY]" (the only READY trigger).
//                       Otherwise, by the number N of user messages: N=1..3 "Mock question N: <when / where /
//                       who + money>?"; N>=4 "Mock read-back: I noted that <first user message, max 200>.
//                       Is this correct?" (zh: 模拟问题 N： / 模拟复述：). Streamed in 5-char chunks, so "[READY]"
//                       arrives split across chunks.
//   - extract        -> ReportFacts JSON that ECHOES the transcript's "User: ..." lines into incident_summary_en
//                       (so the passport/phone scrub can be tested). "BADJSON" in the user text =>
//                       invalid JSON on the first try, valid on the retry; "BADJSON2" => invalid always.
//   - Thai summary   -> fixed Markdown with the two prompt headings, echoing incident_summary_en.
//   - fair price     -> first line is the verdict computed in code from the REFERENCE PRICES
//                       (computeVerdict in constants.ts), then the range line and tips.
//   - router         -> {"feature":"legal","reason":"mock"}.
// "STREAMERROR" anywhere in the user text => the stream fails after the first chunk.
// "UPSTREAMBUSY" anywhere in the user text => the call fails before any output with an APICallError 429 (daily-quota
//   body), so routes answer 503 unavailable (JSON) instead of a stream. The mock has no fallback model.
// "NOANSWER" is handled by the legal pipeline (retrieval is skipped, so no sources pass).
// embed(): feature-hashed token vector (stopwords dropped, light stemming, CJK bigrams), 1536 dims, unit length,
//   deterministic. Good enough that mock retrieval over content/legal finds the right topic.
// ---------------------------------------------------------------------------------------------
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { embed as aiEmbed, embedMany as aiEmbedMany, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { debugFetch, withFallback, type LanguageModelV4 } from "./fallback";
import { mockRespond } from "./mock-model";

export type AiProviderName = "anthropic" | "openai" | "google" | "mock";
export type EmbeddingProviderName = "openai" | "google";
/** "document" = text to be searched (ingest, sample index); "query" = a user's question. */
export type EmbedTask = "document" | "query";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const GOOGLE_EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 1536;

/**
 * Google ids (2026-11-20): versioned, non-preview models that actually answered a live call with the project key.
 * models.list also shows gemini-2.5-pro / gemini-2.5-flash (404 "no longer available to new users"),
 * gemini-3.1-pro-preview (429, no free-tier quota) and gemini-3.8-flash (503 "high demand" on every try).
 * A paid key can set AI_MODEL_CHAT to a pro-class model.
 */
export const MODEL_DEFAULTS: Record<Exclude<AiProviderName, "mock">, { chat: string; fast: string }> = {
  anthropic: { chat: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
  openai: { chat: "gpt-4.1", fast: "gpt-4.1-mini" },
  google: { chat: "gemini-3.5-flash", fast: "gemini-3.5-flash-lite" },
};

/** Thrown when the AI backend can't be used (missing key, bad config). Routes map it to 503 `unavailable`. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export function aiProvider(): AiProviderName {
  const v = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (v === "" || v === "anthropic") return "anthropic";
  if (v === "openai" || v === "google" || v === "mock") return v;
  throw new AiUnavailableError(`Unknown AI_PROVIDER "${v}"`);
}

export function embeddingProvider(): EmbeddingProviderName {
  const v = (process.env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase();
  if (v === "openai" || v === "google") return v;
  if (v !== "") throw new AiUnavailableError(`Unknown EMBEDDING_PROVIDER "${v}"`);
  return aiProvider() === "google" ? "google" : "openai";
}

/** Names the vector space in use. Vectors from different ids must never be compared or mixed in legal_chunks. */
export function embeddingModelId(): string {
  if (isMock()) return "mock";
  return embeddingProvider() === "google"
    ? `google:${GOOGLE_EMBEDDING_MODEL}@${EMBEDDING_DIMS}`
    : `openai:${EMBEDDING_MODEL}`;
}

export const isMock = () => aiProvider() === "mock";

type KeyName = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
const EMBEDDING_KEY: Record<EmbeddingProviderName, KeyName> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

function requireKey(name: KeyName): string {
  const key = process.env[name];
  if (!key) throw new AiUnavailableError(`${name} is not set`);
  return key;
}

let mockModel: MockLanguageModelV4 | undefined;
function getMockModel(): MockLanguageModelV4 {
  mockModel ??= new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-model",
    doGenerate: async (options) => mockRespond(options.prompt).generate(),
    doStream: async (options) => mockRespond(options.prompt).stream(),
  });
  return mockModel;
}

function model(kind: "chat" | "fast"): LanguageModel {
  const p = aiProvider();
  if (p === "mock") return getMockModel();
  const override = kind === "chat" ? process.env.AI_MODEL_CHAT : process.env.AI_MODEL_FAST;
  const id = override?.trim() || MODEL_DEFAULTS[p][kind];
  if (p === "anthropic") return createAnthropic({ apiKey: requireKey("ANTHROPIC_API_KEY") })(id);
  if (p === "google") return googleModel(id);
  return createOpenAI({ apiKey: requireKey("OPENAI_API_KEY") })(id);
}

const DEFAULT_GOOGLE_FALLBACK = "gemini-3.5-flash-lite";

/**
 * Fallback model id for a Google primary: AI_MODEL_FALLBACK, else gemini-3.5-flash-lite, else (when the primary IS
 * flash-lite, i.e. the fast model) the default chat model. null when it would be the primary itself.
 */
export function googleFallbackId(primaryId: string): string | null {
  const configured = process.env.AI_MODEL_FALLBACK?.trim();
  const id = configured || (primaryId !== DEFAULT_GOOGLE_FALLBACK ? DEFAULT_GOOGLE_FALLBACK : MODEL_DEFAULTS.google.chat);
  return id === primaryId ? null : id;
}

function googleProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey, fetch: debugFetch() });
}

/** Gemini model wrapped with a one-shot fallback on 429/5xx before output (lib/ai/fallback.ts). */
function googleModel(id: string): LanguageModel {
  const google = googleProvider(requireKey("GOOGLE_GENERATIVE_AI_API_KEY"));
  const primary = google(id) as LanguageModelV4;
  const fb = googleFallbackId(id);
  return fb ? withFallback(primary, google(fb) as LanguageModelV4) : primary;
}

/**
 * Per-call provider options, spread into every generateText/streamText call. Gemini 3.x thinks by default, its
 * thinking tokens count against maxOutputTokens, and a live /api/chat answer came back as planning fragments, so
 * thinking is kept minimal and thought text is never requested. Other providers: no options.
 */
export function modelCallOptions(): {
  maxRetries?: number;
  providerOptions?: { google: { thinkingConfig: { thinkingLevel: "minimal"; includeThoughts: false } } };
} {
  // maxRetries 0: fail fast; googleModel()'s fallback covers a busy primary (lib/ai/fallback.ts).
  return aiProvider() === "google"
    ? { maxRetries: 0, providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } } } }
    : {};
}

/** Main model: legal answers, interview, Thai summary, fair-price explanation. */
export const chatModel = () => model("chat");
/** Cheap model: query rewrite, router, fact extraction. */
export const fastModel = () => model("fast");

/** Throws AiUnavailableError if embeddings can't be used (missing key for EMBEDDING_PROVIDER). Call before paid work. */
export function requireEmbeddingKey(): void {
  if (!isMock()) requireKey(EMBEDDING_KEY[embeddingProvider()]);
}

type EmbedOptions = { task?: EmbedTask };

function embeddingSetup(task: EmbedTask) {
  const p = embeddingProvider();
  const apiKey = requireKey(EMBEDDING_KEY[p]);
  if (p === "google") {
    return {
      model: googleProvider(apiKey).embeddingModel(GOOGLE_EMBEDDING_MODEL),
      providerOptions: {
        google: {
          outputDimensionality: EMBEDDING_DIMS,
          taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        },
      },
    };
  }
  return { model: createOpenAI({ apiKey }).embedding(EMBEDDING_MODEL), providerOptions: undefined };
}

// Gemini's free tier counts EVERY embedded text as one request (embed_content_free_tier_requests, 100/min), so a
// batch of 128 chunks fails with 429. Google embeddings therefore go out in batches of GOOGLE_EMBED_BATCH and are
// paced to GOOGLE_EMBED_PER_MIN texts per rolling minute (per server instance). This is a bounded wait, not a retry.
export const GOOGLE_EMBED_BATCH = 50;
/** One retry (not the SDK's 2): a single transient 429 during the sample index build shouldn't fail the question. */
export const GOOGLE_EMBED_MAX_RETRIES = 1;
const DEFAULT_GOOGLE_EMBED_PER_MIN = 90;

export function googleEmbedPerMinute(): number {
  const n = Math.floor(Number(process.env.GOOGLE_EMBED_PER_MIN));
  return Number.isFinite(n) && n >= GOOGLE_EMBED_BATCH ? n : DEFAULT_GOOGLE_EMBED_PER_MIN;
}

const embedWindow: number[] = []; // one timestamp per text sent in the last minute
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until `n` more texts fit in the rolling one-minute window, then records them. `n` must be <= the limit.
 * `now`/`wait` are injectable for tests.
 */
export async function reserveGoogleEmbeds(
  n: number,
  limit = googleEmbedPerMinute(),
  now: () => number = Date.now,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<void> {
  for (;;) {
    const t = now();
    while (embedWindow.length && embedWindow[0]! <= t - 60_000) embedWindow.shift();
    if (embedWindow.length + n <= limit) {
      for (let i = 0; i < n; i++) embedWindow.push(t);
      return;
    }
    // Oldest entries that must expire before n more fit.
    const mustExpire = embedWindow[embedWindow.length + n - limit - 1]!;
    await wait(mustExpire + 60_000 - t + 250);
  }
}

/** Tests only. */
export function resetGoogleEmbedWindow(): void {
  embedWindow.length = 0;
}

/** Scales a vector to unit length (a zero vector is returned unchanged). */
export function normalizeVector(v: readonly number[]): number[] {
  let sq = 0;
  for (const x of v) sq += x * x;
  const n = Math.sqrt(sq);
  return n > 0 ? v.map((x) => x / n) : [...v];
}

/** Embeds one text. `task` defaults to "query" (the only single-text caller embeds questions). */
export async function embed(text: string, opts: EmbedOptions = {}): Promise<number[]> {
  if (isMock()) return mockEmbedding(text);
  const { model, providerOptions } = embeddingSetup(opts.task ?? "query");
  if (providerOptions) await reserveGoogleEmbeds(1);
  const { embedding } = await aiEmbed({
    model,
    value: text,
    providerOptions,
    maxRetries: providerOptions ? GOOGLE_EMBED_MAX_RETRIES : undefined,
  });
  return normalizeVector(embedding);
}

/** Embeds many texts. `task` defaults to "document" (ingest and the sample index). */
export async function embedMany(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (isMock()) return texts.map(mockEmbedding);
  const { model, providerOptions } = embeddingSetup(opts.task ?? "document");
  if (!providerOptions) {
    const { embeddings } = await aiEmbedMany({ model, values: texts, maxParallelCalls: 2, providerOptions });
    return embeddings.map(normalizeVector);
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += GOOGLE_EMBED_BATCH) {
    const values = texts.slice(i, i + GOOGLE_EMBED_BATCH);
    await reserveGoogleEmbeds(values.length);
    const { embeddings } = await aiEmbedMany({
      model,
      values,
      maxParallelCalls: 1,
      providerOptions,
      maxRetries: GOOGLE_EMBED_MAX_RETRIES,
    });
    out.push(...embeddings.map(normalizeVector));
  }
  return out;
}

// ---------- mock embedding ----------
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Function words carry no topic, and with plain bag-of-words they dominate short questions (an off-topic
// "what is the weather like" would otherwise pass the 0.30 threshold). Dropping them keeps mock retrieval sane.
const MOCK_STOPWORDS = new Set(
  ("a an the and or but if of to in on at by for from with without about as is are was were be been being am do " +
    "does did can could should would will may might must i me my we our you your he she it its they them their " +
    "this that these those there here what which who whom when where why how not no yes so than too very just " +
    "also into out up down over under again only own same such any all some more most other each few both").split(" "),
);
const MOCK_CJK_STOP = new Set(Array.from("的了吗呢吧啊是在我你他她它们这那有和与及或就都也很可以会能要不没什么怎么"));

/** Light English stemming so "taxis"/"taxi" and "fines"/"fine" share a bucket. */
function mockStem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const CJK_RUN = new RegExp("[\\u3400-\\u9fff\\uf900-\\ufaff\\u0e00-\\u0e7f]+", "gu");

/** Mock tokens: stemmed latin words minus stopwords; CJK/Thai characters as unigrams + bigrams (minus function chars). */
export function mockTokens(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const w of t.match(/[a-z0-9]+/g) ?? []) if (!MOCK_STOPWORDS.has(w)) out.push(mockStem(w));
  for (const run of t.match(CJK_RUN) ?? []) {
    const cs = Array.from(run).filter((c) => !MOCK_CJK_STOP.has(c));
    for (let i = 0; i < cs.length; i++) {
      out.push(cs[i]!);
      if (i + 1 < cs.length) out.push(cs[i]! + cs[i + 1]!);
    }
  }
  return out;
}

/** Deterministic unit vector: mockTokens() feature-hashed into 1536 buckets. */
export function mockEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  for (const t of mockTokens(text)) {
    const h = fnv1a(t);
    v[h % EMBEDDING_DIMS]! += h & 0x80000000 ? -1 : 1;
  }
  const norm = Math.hypot(...v);
  if (norm === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norm);
}
