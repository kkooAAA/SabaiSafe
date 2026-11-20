// Plain streaming-protocol constants with no dependencies (no zod), safe to import from client components.
// Re-exported by types/api.ts. Source of truth: docs/contracts.md §3.

/** Marker line between the streamed answer text and the trailing JSON. */
export const SOURCES_DELIMITER = "\n\u001eSOURCES\u001e\n";

/**
 * Terminal marker for ALL streamed routes (/api/chat, /api/report/chat, /api/chat/price): if the model fails
 * after streaming has started, the server appends this and closes. Nothing follows it (no trailer).
 * Clients render only text before the first "\n\u001e".
 */
export const ERROR_MARKER = "\n\u001eERROR\u001e\n";

export const READY_TOKEN = "[READY]";

/** Price unit keys; the UI translates them via messages (price.unit.<key>). */
export const PRICE_UNITS = [
  "per_trip",
  "per_km",
  "per_person",
  "per_30min",
  "per_hour",
  "per_day",
  "per_week",
  "per_night",
  "per_item",
  "per_kg",
] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const BUSINESS_CRITERIA = [
  "registered_business", // has a Thai business registration / tourism licence
  "displays_prices", // prices displayed before purchase
  "written_contract", // rentals: written contract in English or Chinese
  "no_passport_deposit", // rentals: does not keep passports as deposit
  "insurance", // rentals/activities: insurance included or offered
  "receipts", // issues receipts
] as const;

/** Conversation limits for /api/report/chat and /api/report/generate (enforced by `Conversation` in types/api.ts). */
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CONVERSATION_MESSAGES = 60;
/** Total characters across a conversation, to cap LLM cost per call. */
export const MAX_CONVERSATION_CHARS = 20_000;

/** PDPA consent text version; /api/report/save rejects any other value with 400 consent_outdated. */
export const CONSENT_VERSION = "2026-11-v1";
