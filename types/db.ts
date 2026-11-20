// Database row types. Owner: backend. Source of truth: docs/contracts.md §2 and supabase/migrations/.
// API shapes (PriceRef, HelpContact, Business, ...) live in types/api.ts; DB rows add timestamps.
import type {
  Business,
  ContentStatus,
  HelpContact,
  LegalTopic,
  PriceRef,
  ReportFacts,
  UiLang,
} from "./api";

export type Timestamps = { created_at: string; updated_at: string };

export type PriceRow = PriceRef & Timestamps;
export type PriceInsert = Omit<PriceRef, "id">;

export type BusinessRow = Business & Timestamps;
export type BusinessInsert = Omit<Business, "id">;

export type HelpContactRow = HelpContact & Timestamps;
export type HelpContactInsert = Omit<HelpContact, "id">;

/** §2.1 legal_chunks */
export type LegalChunkRow = {
  id: number;
  doc_slug: string;
  chunk_index: number;
  lang: UiLang;
  title: string;
  law: string;
  law_th: string | null;
  section: string | null; // may be "TO VERIFY"
  location: string | null;
  source_url: string | null;
  topic: LegalTopic;
  status: ContentStatus;
  heading: string | null;
  content: string;
  content_hash: string;
  embedding: number[]; // 1536 dims
} & Timestamps;

/** What ingest upserts: every §2.1 column except id and timestamps. */
export type LegalChunkInsert = Omit<LegalChunkRow, "id" | "created_at" | "updated_at">;

/** One row returned by RPC match_legal (§2.2). */
export type LegalMatchRow = {
  id: number;
  doc_slug: string;
  chunk_index: number;
  lang: UiLang;
  title: string;
  law: string;
  law_th: string | null;
  section: string | null;
  location: string | null;
  source_url: string | null;
  topic: LegalTopic;
  status: ContentStatus;
  heading: string | null;
  content: string;
  similarity: number;
};

/** §2.6 reports. Only the service role reads/writes it. */
export type ReportRow = {
  id: string;
  lang: UiLang;
  incident_type: string;
  facts: ReportFacts;
  markdown: string;
  consent_at: string;
  consent_version: string;
  delete_token_hash: string; // sha256 hex of the delete token
  expires_at: string;
} & Timestamps;

/** consent_at / expires_at are never accepted from the caller: SQL (or the in-memory store) sets them. */
export type ReportInsert = Pick<ReportRow, "lang" | "incident_type" | "facts" | "markdown" | "consent_version" | "delete_token_hash">;

/** What getReport returns. */
export type StoredReport = Pick<ReportRow, "facts" | "markdown" | "expires_at">;
