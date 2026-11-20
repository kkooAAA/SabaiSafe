// Fixtures for AI_PROVIDER=mock. Deterministic; used by tests and CI. Not real legal content.
import type { LegalSource } from "@/types/api";

/** Trigger words a test can put in user text to drive the mock. Documented in lib/ai/provider.ts. */
export const MOCK_TRIGGERS = {
  noAnswer: "NOANSWER",
  badJsonOnce: "BADJSON",
  badJsonAlways: "BADJSON2",
  streamError: "STREAMERROR",
  /** The model call fails BEFORE any output with an upstream 429 (as when the Gemini quota is used up). */
  upstreamBusy: "UPSTREAMBUSY",
} as const;

export const MOCK_EMERGENCY_RE = /emergency|hurt|injur|attack|assault|danger|bleed|救命|受伤|危险/i;
/** "yes" / "correct" as a whole word ("Yesterday ..." is not a confirmation), or 是 / 对 / 没错 at the start. */
export const MOCK_CONFIRM_RE = /^\s*(?:(?:yes|correct)(?![a-z])|是|对|没错)/i;

/** The two sources the mock legal pipeline "retrieves" (id 1 DRAFT, id 2 VERIFIED). */
export const MOCK_LEGAL_SOURCES: LegalSource[] = [
  {
    id: 1,
    chunk_id: 900001,
    doc_slug: "sample-motorbike-rental",
    title: "[SAMPLE] Motorbike rental deposits",
    law: "Consumer Protection Act B.E. 2522",
    law_th: "พ.ร.บ.คุ้มครองผู้บริโภค พ.ศ. 2522",
    section: "TO VERIFY",
    location: "Phuket",
    source_url: null,
    status: "DRAFT",
    similarity: 0.82,
    excerpt: "[SAMPLE] Mock excerpt about rental deposits and damage claims. Not real legal content.",
  },
  {
    id: 2,
    chunk_id: 900002,
    doc_slug: "sample-tourist-police",
    title: "[SAMPLE] Reporting to the Tourist Police",
    law: "Police procedure (sample)",
    law_th: null,
    section: null,
    location: null,
    source_url: null,
    status: "VERIFIED",
    similarity: 0.71,
    excerpt: "[SAMPLE] Mock excerpt about how to report an incident to the Tourist Police (1155).",
  },
];
