// Model + embedding provider for all AI routes. Server-only (never import from client components).
//
// AI_PROVIDER = "anthropic" | "openai" | "mock" (unset => "anthropic").
//   - chat/fast models come from the chosen provider; override ids with AI_MODEL_CHAT / AI_MODEL_FAST.
//   - embeddings are ALWAYS OpenAI text-embedding-3-small (1536 dims), so OPENAI_API_KEY is needed
//     in every non-mock mode. A missing key throws AiUnavailableError (routes map it to 503).
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
// "NOANSWER" is handled by the legal pipeline (retrieval is skipped, so no sources pass).
// embed(): feature-hashed token vector (stopwords dropped, light stemming, CJK bigrams), 1536 dims, unit length,
//   deterministic. Good enough that mock retrieval over content/legal finds the right topic.
// ---------------------------------------------------------------------------------------------
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { embed as aiEmbed, embedMany as aiEmbedMany, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { mockRespond } from "./mock-model";

export type AiProviderName = "anthropic" | "openai" | "mock";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

export const MODEL_DEFAULTS: Record<Exclude<AiProviderName, "mock">, { chat: string; fast: string }> = {
  anthropic: { chat: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
  openai: { chat: "gpt-4.1", fast: "gpt-4.1-mini" },
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
  if (v === "openai" || v === "mock") return v;
  throw new AiUnavailableError(`Unknown AI_PROVIDER "${v}"`);
}

export const isMock = () => aiProvider() === "mock";

function requireKey(name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"): string {
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
  return createOpenAI({ apiKey: requireKey("OPENAI_API_KEY") })(id);
}

/** Main model: legal answers, interview, Thai summary, fair-price explanation. */
export const chatModel = () => model("chat");
/** Cheap model: query rewrite, router, fact extraction. */
export const fastModel = () => model("fast");

/** Throws AiUnavailableError if embeddings can't be used (no OPENAI_API_KEY outside mock mode). Call before paid work. */
export function requireEmbeddingKey(): void {
  if (!isMock()) requireKey("OPENAI_API_KEY");
}

function embeddingModel() {
  return createOpenAI({ apiKey: requireKey("OPENAI_API_KEY") }).embedding(EMBEDDING_MODEL);
}

export async function embed(text: string): Promise<number[]> {
  if (isMock()) return mockEmbedding(text);
  const { embedding } = await aiEmbed({ model: embeddingModel(), value: text });
  return embedding;
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (isMock()) return texts.map(mockEmbedding);
  const { embeddings } = await aiEmbedMany({ model: embeddingModel(), values: texts, maxParallelCalls: 2 });
  return embeddings;
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
