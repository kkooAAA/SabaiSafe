// Fair Price reference rows. Owner: backend. Contracts v0.2 §3.6 / §3.7 / §4.
// Used by GET /api/price, ai's /api/chat/price (direct call) and frontend Server Components.
// DB mode loads the (small) table once per minute and filters in JS with the same code as sample mode, so
// user input never reaches a PostgREST filter string.
import type { PriceRef } from "@/types/api";
import { createAnonClient, isSampleMode } from "./client";
import { DbError } from "./errors";
import { filterPrices, type PriceQuery } from "./query";
import { getSampleData } from "./sample";

const TTL_MS = 60_000;
const PRICE_COLUMNS =
  "id,item_key,item_name_en,item_name_zh,category,area,min_thb,max_thb,unit,is_fixed_by_law,source,source_url,collected_at,notes,notes_zh,is_sample";

let cache: { at: number; rows: PriceRef[] } | null = null;

async function loadPrices(): Promise<PriceRef[]> {
  if (isSampleMode()) return getSampleData().prices;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const { data, error } = await createAnonClient().from("prices").select(PRICE_COLUMNS).limit(5000);
  if (error) throw new DbError("Failed to load prices", { cause: error });
  const rows = (data ?? []).map(
    (r): PriceRef => ({ ...(r as PriceRef), min_thb: Number(r.min_thb), max_thb: Number(r.max_thb) }),
  );
  cache = { at: Date.now(), rows };
  return rows;
}

/** Reference prices for an item and/or area (both optional). Throws DbError / DbUnavailableError. */
export async function findPrices(query: PriceQuery = {}): Promise<PriceRef[]> {
  return filterPrices(await loadPrices(), query);
}

/** Tests / admin writes: drop the 60 s cache. */
export function resetPriceCache(): void {
  cache = null;
}
