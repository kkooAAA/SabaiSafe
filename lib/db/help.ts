// Help contacts and trusted businesses. Owner: backend. Contracts v0.2 §2.4 / §2.5 / §3.8 / §4.
// The four hotlines are always included (from lib/hotlines.ts if the DB lacks them).
// Callers that render a page should catch errors and fall back to lib/hotlines.ts (§2.5).
import { z } from "zod";
import type { Business, HelpContact, HelpResponse } from "@/types/api";
import { createAnonClient, isSampleMode } from "./client";
import { DbError } from "./errors";
import { filterHelp } from "./query";
import { getSampleData } from "./sample";
import { BUSINESS_CATEGORIES, HELP_CATEGORIES } from "./schema";

/** Valid `category` values for GET /api/help: any HelpContact or Business category. */
export const HelpCategoryParam = z.enum([
  ...HELP_CATEGORIES,
  ...BUSINESS_CATEGORIES.filter((c) => c !== "other"),
] as [HelpCategoryParam, ...HelpCategoryParam[]]);
export type HelpCategoryParam = HelpContact["category"] | Business["category"];

const TTL_MS = 60_000;
const CONTACT_COLUMNS =
  "id,category,name_en,name_zh,name_th,phone,address,area,google_maps_url,website,hours,languages,source_url,sort_order,verified,is_sample";
const BUSINESS_COLUMNS =
  "id,name,name_zh,category,area,address,phone,website,google_maps_url,source_url,description_en,description_zh,criteria_met,is_sponsored,verified_at,is_active,is_sample";

let cache: { at: number; contacts: HelpContact[]; businesses: Business[] } | null = null;

async function loadHelp(): Promise<{ contacts: HelpContact[]; businesses: Business[] }> {
  if (isSampleMode()) return getSampleData();
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const db = createAnonClient();
  const [c, b] = await Promise.all([
    db.from("help_contacts").select(CONTACT_COLUMNS).limit(5000),
    db.from("businesses").select(BUSINESS_COLUMNS).eq("is_active", true).limit(5000),
  ]);
  if (c.error) throw new DbError("Failed to load help_contacts", { cause: c.error });
  if (b.error) throw new DbError("Failed to load businesses", { cause: b.error });
  cache = { at: Date.now(), contacts: (c.data ?? []) as HelpContact[], businesses: (b.data ?? []) as Business[] };
  return cache;
}

/** Contacts (always incl. the four hotlines) and active businesses, optionally filtered by category. */
export async function getHelp(query: { category?: HelpCategoryParam | null } = {}): Promise<HelpResponse> {
  const { contacts, businesses } = await loadHelp();
  return filterHelp(contacts, businesses, query.category);
}

/** Tests / admin writes: drop the 60 s cache. */
export function resetHelpCache(): void {
  cache = null;
}
