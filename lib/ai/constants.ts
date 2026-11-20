// Fixed, localized strings used by the AI routes. Exact strings so the UI, tests and evals can match them.
import type { UiLang } from "@/types/api";
import { DISCLAIMER } from "./prompts";

export { DISCLAIMER };

/** Streamed by /api/chat when no source passes the similarity threshold (the answer model is not called). */
export const NO_ANSWER_MESSAGE: Record<UiLang, string> = {
  en:
    "I don't have verified information on this yet. Please call Tourist Police 1155 (English and Chinese available) " +
    "or ask at the nearest tourist police booth.\n\n" +
    DISCLAIMER.en,
  zh:
    "我们目前还没有关于这个问题的核实信息。请拨打旅游警察电话 1155（提供英语和中文服务），或前往最近的旅游警察服务点咨询。\n\n" +
    DISCLAIMER.zh,
};

// The verdict rule lives in types/price-verdict.ts (one copy shared with the UI). Re-exported for convenience.
export { computeVerdict, FAR_ABOVE_FACTOR, VERDICT_ZH, type PriceVerdict } from "@/types/price-verdict";

/** Sent as a follow-up user message when fact extraction returned invalid JSON (one retry). */
export const EXTRACT_RETRY_MESSAGE =
  "Your previous reply was not valid JSON matching the shape. Reply again with ONLY the JSON object.";

/** Default similarity threshold for legal retrieval (override with LEGAL_MIN_SIMILARITY). */
export const DEFAULT_MIN_SIMILARITY = 0.3;

export function minSimilarity(): number {
  const v = Number(process.env.LEGAL_MIN_SIMILARITY);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULT_MIN_SIMILARITY;
}

/**
 * Used only when the query rewriter fails: a conservative "this may be an emergency" hint so the UI still shows
 * the 1155 / 191 / 1669 banner. False positives are acceptable (the banner is harmless); misses are not.
 */
export const EMERGENCY_HINT_RE =
  /emergenc|hurt|injur|attack|assault|danger|bleed|robbed|rape|kidnap|threat|unconscious|drown|救命|受伤|危险|抢劫|袭击|威胁|绑架|流血|溺水/i;
