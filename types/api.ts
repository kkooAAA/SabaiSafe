// Shared API contract types. Source of truth: docs/contracts.md (section 3).
// Changing a shape here needs agreement from frontend, backend and ai, recorded in docs/contracts.md.
import { z } from "zod";
import {
  CONSENT_VERSION,
  MAX_CONVERSATION_CHARS,
  MAX_CONVERSATION_MESSAGES,
  MAX_MESSAGE_CHARS,
} from "./protocol";

// ---------- common ----------
export const UiLang = z.enum(["en", "zh"]);
export type UiLang = z.infer<typeof UiLang>;

/** fields: validation errors keyed by field path ("min_thb", "criteria_met.2"), admin routes only. */
export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

// Limits and CONSENT_VERSION live in the zod-free types/protocol.ts (client-safe); re-exported here.
export { CONSENT_VERSION, MAX_CONVERSATION_CHARS, MAX_CONVERSATION_MESSAGES, MAX_MESSAGE_CHARS } from "./protocol";
export const Conversation = z
  .array(ChatMessage)
  .min(1)
  .max(MAX_CONVERSATION_MESSAGES)
  .refine((ms) => ms.reduce((n, m) => n + m.content.length, 0) <= MAX_CONVERSATION_CHARS, {
    message: "conversation_too_long",
  });

// ---------- Legal Guide: POST /api/chat ----------
export const ChatRequest = z.object({
  question: z.string().trim().min(1).max(1000),
  lang: UiLang,
});
export type ChatRequest = z.infer<typeof ChatRequest>;

// Client code should import these from "@/types/protocol" (no zod in the bundle).
export { SOURCES_DELIMITER, ERROR_MARKER, READY_TOKEN } from "./protocol";

export type LegalTopic =
  | "scam"
  | "price"
  | "transport"
  | "rental"
  | "alcohol_drugs"
  | "beach_rules"
  | "accommodation"
  | "police_procedure"
  | "visa_immigration"
  | "other";

export type ContentStatus = "DRAFT" | "VERIFIED";

export type LegalSource = {
  id: number; // citation number used in the answer text: [1], [2], ...
  chunk_id: number;
  doc_slug: string;
  title: string;
  law: string;
  law_th: string | null;
  section: string | null; // may be "TO VERIFY"
  location: string | null;
  source_url: string | null;
  status: ContentStatus;
  similarity: number;
  excerpt: string; // <= 300 chars
};

export type ChatTrailer = {
  sources: LegalSource[];
  meta: {
    is_emergency: boolean;
    no_answer: boolean; // true when retrieval found nothing usable
    topic: LegalTopic;
    location: string | null;
  };
};

// ---------- Report Assistant ----------
export const ReportChatRequest = z.object({
  messages: Conversation,
  lang: UiLang,
});
export type ReportChatRequest = z.infer<typeof ReportChatRequest>;


export const IncidentType = z.enum(["scam", "overcharge", "theft", "damage_claim", "assault", "other"]);

// Mirrors REPORT_EXTRACT_SYSTEM in lib/ai/prompts.ts. No passport field, by design (PDPA).
export const ReportFacts = z.object({
  incident_type: IncidentType,
  incident_summary_en: z.string(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  location: z.string().nullable(),
  parties: z.array(
    z.object({
      role: z.enum(["business", "person", "driver", "other"]),
      name: z.string().nullable(),
      description: z.string().nullable(),
      vehicle_plate: z.string().nullable(),
    }),
  ),
  money: z.object({
    amount: z.number().nullable(),
    currency: z.string().nullable(),
    type: z.enum(["lost", "demanded", "paid"]).nullable(),
    payment_method: z.string().nullable(),
  }),
  evidence: z.array(z.string()),
  witnesses: z.string().nullable(),
  user_goal: z.string().nullable(),
  reporter: z.object({ nationality: z.string().nullable(), name: z.string().nullable() }),
});
export type ReportFacts = z.infer<typeof ReportFacts>;

export const ReportGenerateRequest = z.object({
  messages: Conversation,
});
export type ReportGenerateResponse = { facts: ReportFacts; markdown: string };

export const ReportPdfRequest = z.object({
  markdown: z.string().min(1).max(20000),
  facts: ReportFacts.optional(),
});

export const ReportSaveRequest = z.object({
  facts: ReportFacts,
  markdown: z.string().min(1).max(20000),
  lang: UiLang,
  consent: z.literal(true),
  consent_version: z.literal(CONSENT_VERSION),
});
/** delete_token is returned once, never stored in plain text (sha256 only). */
export type ReportSaveResponse = { id: string; expires_at: string; delete_token: string };

// ---------- Fair Price ----------
// PRICE_UNITS and BUSINESS_CRITERIA live in the zod-free types/protocol.ts (client-safe); re-exported here.
import { PRICE_UNITS, type PriceUnit } from "./protocol";
export { PRICE_UNITS, BUSINESS_CRITERIA, type PriceUnit } from "./protocol";

export type PriceCategory = "transport" | "rental" | "activity" | "food" | "accommodation" | "other";

export type PriceRef = {
  id: string;
  item_key: string;
  item_name_en: string;
  item_name_zh: string;
  category: PriceCategory;
  area: string;
  min_thb: number;
  max_thb: number;
  unit: PriceUnit;
  is_fixed_by_law: boolean;
  source: string;
  source_url: string | null;
  collected_at: string; // YYYY-MM-DD
  notes: string | null;
  notes_zh: string | null;
  is_sample: boolean;
};

export type PriceResponse = { results: PriceRef[] };

export const PriceExplainRequest = z.object({
  item: z.string().trim().min(1).max(200),
  quoted: z.number().positive().max(10_000_000).nullable(),
  area: z.string().trim().max(100).nullable().optional(),
  /** The unit of the row the user is looking at. If absent and rows mix units, pick the first in PRICE_UNITS order. */
  unit: z.enum(PRICE_UNITS).nullable().optional(),
  lang: UiLang,
});
export type PriceExplainRequest = z.infer<typeof PriceExplainRequest>;

// ---------- Help & Trusted Services ----------
export type HelpCategory = "emergency" | "police" | "hospital" | "embassy" | "consumer" | "immigration" | "other";

export type HelpContact = {
  id: string;
  category: HelpCategory;
  name_en: string;
  name_zh: string | null;
  name_th: string | null;
  phone: string | null;
  address: string | null;
  area: string | null;
  google_maps_url: string | null;
  website: string | null;
  hours: string | null;
  languages: string[];
  source_url: string | null; // official page backing phone/address; required for a non-null phone
  sort_order: number;
  verified: boolean; // a human checked phone/address against an official source
  is_sample: boolean;
};

export type BusinessCategory = "rental" | "transport" | "tour" | "hotel" | "restaurant" | "shop" | "other";

export type Business = {
  id: string;
  name: string;
  name_zh: string | null;
  category: BusinessCategory;
  area: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  google_maps_url: string | null;
  source_url: string | null;
  description_en: string | null;
  description_zh: string | null;
  criteria_met: string[]; // keys from BUSINESS_CRITERIA
  is_sponsored: boolean;
  verified_at: string | null; // YYYY-MM-DD
  is_active: boolean;
  is_sample: boolean;
};

export type HelpResponse = { contacts: HelpContact[]; businesses: Business[] };

// ---------- Admin (§3.9, Phase 4) ----------
export type PriceInput = Omit<PriceRef, "id">;
export type BusinessInput = Omit<Business, "id">;
/** persisted=false ⇒ sample-mode in-memory overlay, lost on restart (also header X-Admin-Persisted). */
export type AdminListResponse<T> = { results: T[]; persisted: boolean };
export type AdminWriteResponse<T> = { row: T; persisted: boolean };
