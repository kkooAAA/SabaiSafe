// Fair Price explanation pipeline (contracts §3.7): findPrices → fairPriceSystem/fairPriceUser → stream.
import { streamText } from "ai";
import { PRICE_UNITS, type PriceExplainRequest, type PriceRef, type PriceUnit } from "@/types/api";
import { computeVerdict, selectRefs } from "@/types/price-verdict";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { findPrices } from "@/lib/db/prices";
import { fairPriceSystem, fairPriceUser } from "./prompts";
import { chatModel, modelCallOptions } from "./provider";
import { textDeltas, textStreamResponse, primeDeltas } from "./stream";

/**
 * Readable unit for the model (so the PriceUnit key never leaks into the answer).
 * Single source: frontend's messages/{en,zh}.json at price.unit.<key>, so the table and the AI text use the same words.
 */
export const UNIT_LABEL = Object.fromEntries(
  PRICE_UNITS.map((u) => [u, { en: enMessages.price.unit[u], zh: zhMessages.price.unit[u] }]),
) as Record<PriceUnit, Record<PriceExplainRequest["lang"], string>>;

/** Maps DB rows to the prompt's reference shape, with the item name and unit in the UI language. */
export function toPromptRefs(refs: PriceRef[], lang: PriceExplainRequest["lang"]) {
  return refs.map((r) => ({
    item: lang === "zh" ? r.item_name_zh || r.item_name_en : r.item_name_en,
    area: r.area,
    min: r.min_thb,
    max: r.max_thb,
    unit: UNIT_LABEL[r.unit]?.[lang] ?? r.unit,
    source: r.source,
    collected_at: r.collected_at,
    is_fixed_by_law: r.is_fixed_by_law,
  }));
}

/** Runs the pipeline. Errors before the stream starts (DB, missing key) are thrown to the route. */
export async function explainPrice(req: PriceExplainRequest, signal?: AbortSignal): Promise<Response> {
  const refs = selectRefs(await findPrices({ item: req.item, area: req.area ?? undefined }), req.area, req.unit);
  const verdict = computeVerdict(
    req.quoted,
    refs.map((r) => r.max_thb),
  );
  const model = chatModel();
  const itemLabel = refs[0] ? (req.lang === "zh" ? refs[0].item_name_zh || refs[0].item_name_en : refs[0].item_name_en) : req.item;
  const result = streamText({
    ...modelCallOptions(),
    model,
    system: fairPriceSystem(req.lang),
    prompt: fairPriceUser(itemLabel, req.quoted, toPromptRefs(refs, req.lang), verdict),
    temperature: 0.2,
    maxOutputTokens: 400,
    abortSignal: signal,
  });
  return textStreamResponse(await primeDeltas(textDeltas(result.stream)), {
    onError: (err) => console.error("[/api/chat/price] stream failed", err),
  });
}
