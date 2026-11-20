// Legal chunks: vector search for the Legal Guide and helpers for scripts/ingest.ts. Owner: backend.
// Contracts v0.2 §2.1 / §2.2 / §4. Works under plain tsx (no Next imports).
import type { UiLang } from "@/types/api";
import type { LegalChunkInsert, LegalMatchRow } from "@/types/db";
import { createAnonClient, createServiceClient, isSampleMode } from "./client";
import { DbError } from "./errors";

export const EMBEDDING_DIMS = 1536;
const MAX_MATCH = 20;
const UPSERT_BATCH = 100;
const PAGE = 1000;

/** pgvector text literal, e.g. "[0.1,0.2]". Safer than relying on JSON-array casting through PostgREST. */
function toVector(embedding: readonly number[]): string {
  if (embedding.length !== EMBEDDING_DIMS) throw new DbError(`embedding must have ${EMBEDDING_DIMS} dims, got ${embedding.length}`);
  if (!embedding.every(Number.isFinite)) throw new DbError("embedding contains a non-finite number");
  return `[${embedding.join(",")}]`;
}

export function chunkKey(doc_slug: string, lang: string, chunk_index: number): string {
  return `${doc_slug}|${lang}|${chunk_index}`;
}

/**
 * RPC match_legal (§2.2). Sample mode returns [] and never throws (ai's mock supplies fixture sources).
 * No similarity threshold here; ai applies LEGAL_MIN_SIMILARITY.
 */
export async function matchLegal(embedding: number[], count: number, lang: UiLang | null): Promise<LegalMatchRow[]> {
  if (isSampleMode()) return [];
  const match_count = Math.min(Math.max(Math.trunc(count) || 1, 1), MAX_MATCH);
  const { data, error } = await createAnonClient().rpc("match_legal", {
    query_embedding: toVector(embedding),
    match_count,
    lang,
  });
  if (error) throw new DbError("match_legal failed", { cause: error });
  return ((data ?? []) as LegalMatchRow[]).map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

type KeyRow = { doc_slug: string; lang: UiLang; chunk_index: number; content_hash: string };

async function allKeys(): Promise<KeyRow[]> {
  const db = createServiceClient();
  const out: KeyRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("legal_chunks")
      .select("doc_slug,lang,chunk_index,content_hash")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new DbError("Failed to list legal_chunks", { cause: error });
    out.push(...((data ?? []) as KeyRow[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** `${doc_slug}|${lang}|${chunk_index}` → content_hash, for every stored chunk. Service role. */
export async function getChunkHashes(): Promise<Map<string, string>> {
  const rows = await allKeys();
  return new Map(rows.map((r) => [chunkKey(r.doc_slug, r.lang, r.chunk_index), r.content_hash]));
}

/** Insert or update chunks on (doc_slug, lang, chunk_index), in batches of 100. Service role. */
export async function upsertLegalChunks(rows: LegalChunkInsert[]): Promise<void> {
  const db = createServiceClient();
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH).map((r) => ({ ...r, embedding: toVector(r.embedding) }));
    const { error } = await db.from("legal_chunks").upsert(batch, { onConflict: "doc_slug,lang,chunk_index" });
    if (error) throw new DbError(`upsert legal_chunks failed at batch ${i / UPSERT_BATCH}`, { cause: error });
  }
}

/** Delete chunks with chunk_index >= keepCount for one document (it got shorter). Returns rows deleted. */
export async function deleteStaleChunks(doc_slug: string, lang: UiLang, keepCount: number): Promise<number> {
  const { error, count } = await createServiceClient()
    .from("legal_chunks")
    .delete({ count: "exact" })
    .eq("doc_slug", doc_slug)
    .eq("lang", lang)
    .gte("chunk_index", Math.max(0, Math.trunc(keepCount)));
  if (error) throw new DbError("deleteStaleChunks failed", { cause: error });
  return count ?? 0;
}

/** Delete all chunks of documents not in `present` (their .md file was removed). Returns rows deleted. */
export async function deleteMissingDocs(present: { doc_slug: string; lang: UiLang }[]): Promise<number> {
  const keep = new Set(present.map((p) => `${p.doc_slug}|${p.lang}`));
  const stored = new Map<string, { doc_slug: string; lang: UiLang }>();
  for (const r of await allKeys()) stored.set(`${r.doc_slug}|${r.lang}`, { doc_slug: r.doc_slug, lang: r.lang });

  const db = createServiceClient();
  let deleted = 0;
  for (const [k, doc] of stored) {
    if (keep.has(k)) continue;
    const { error, count } = await db
      .from("legal_chunks")
      .delete({ count: "exact" })
      .eq("doc_slug", doc.doc_slug)
      .eq("lang", doc.lang);
    if (error) throw new DbError(`deleteMissingDocs failed for ${k}`, { cause: error });
    deleted += count ?? 0;
  }
  return deleted;
}
