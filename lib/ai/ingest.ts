// Legal content ingest (contracts §2.1, §5): content/legal/{en,zh}/*.md → chunks → embeddings → legal_chunks.
// The CLI is scripts/ingest.ts; this module holds the logic with injectable store/embedder so it can be tested
// without Supabase or API keys.
import type { UiLang } from "@/types/api";
import type { LegalChunkInsert } from "@/types/db";
import { chunkDoc, loadLegalDocs, type LegalChunk, type LegalDoc } from "./legal-content";
import { createHash } from "node:crypto";
import { EMBEDDING_DIMS, embedMany as providerEmbedMany, embeddingModelId, mockEmbedding } from "./provider";

/** What ingest needs from lib/db/legal.ts (backend). */
export type IngestStore = {
  getChunkHashes(): Promise<Map<string, string>>;
  upsertLegalChunks(rows: LegalChunkInsert[]): Promise<void>;
  deleteStaleChunks(doc_slug: string, lang: UiLang, keepCount: number): Promise<number>;
  deleteMissingDocs(present: { doc_slug: string; lang: UiLang }[]): Promise<number>;
};

export type IngestOptions = {
  /** content/legal root (with en/ and zh/ folders). */
  dir: string;
  /** No DB access at all; embeddings are the deterministic mock ones (no API key needed). */
  dryRun?: boolean;
  /** Re-embed every chunk even if its hash is unchanged. */
  force?: boolean;
  /** Required unless dryRun. */
  store?: IngestStore;
  /** Defaults to provider.ts#embedMany (real or mock per AI_PROVIDER); dry-run always uses mock embeddings. */
  embedMany?: (texts: string[]) => Promise<number[][]>;
  /** Vector space id folded into content_hash. Defaults to provider.ts#embeddingModelId(). */
  embeddingModelId?: string;
  log?: (line: string) => void;
};

export type IngestReport = {
  dryRun: boolean;
  docs: number;
  chunks: number;
  embedded: number;
  unchanged: number;
  staleDeleted: number;
  missingDeleted: number;
  /** en/zh slugs that exist in only one language (warning, not an error). */
  unpaired: string[];
};

/** Texts per embedding request. */
export const EMBED_BATCH = 64;

const key = (c: Pick<LegalChunk, "doc_slug" | "lang" | "chunk_index">) => `${c.doc_slug}|${c.lang}|${c.chunk_index}`;

function unpairedSlugs(docs: LegalDoc[]): string[] {
  const langsBySlug = new Map<string, Set<UiLang>>();
  for (const d of docs) langsBySlug.set(d.slug, (langsBySlug.get(d.slug) ?? new Set()).add(d.lang));
  return [...langsBySlug].filter(([, ls]) => ls.size < 2).map(([s, ls]) => `${s} (${[...ls].join(",")} only)`);
}

/**
 * The stored content_hash = sha256(chunk hash, embedding model id). Switching EMBEDDING_PROVIDER (or the model)
 * changes every hash, so the next ingest re-embeds every chunk and vectors from two models never mix.
 */
export function hashWithEmbeddingModel(contentHash: string, modelId: string): string {
  return createHash("sha256").update(contentHash).update(String.fromCharCode(0)).update(modelId).digest("hex");
}

async function embedAll(texts: string[], embedMany: (t: string[]) => Promise<number[][]>): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const embs = await embedMany(batch);
    if (embs.length !== batch.length) throw new Error(`embedMany returned ${embs.length} vectors for ${batch.length} texts`);
    for (const e of embs) {
      if (e.length !== EMBEDDING_DIMS) throw new Error(`embedding has ${e.length} dims, expected ${EMBEDDING_DIMS}`);
    }
    out.push(...embs);
  }
  return out;
}

export async function runIngest(opts: IngestOptions): Promise<IngestReport> {
  const log = opts.log ?? (() => {});
  const dryRun = !!opts.dryRun;
  const docs = loadLegalDocs(opts.dir);
  // Never run deleteMissingDocs with an empty set: a wrong --dir would wipe the whole table.
  if (docs.length === 0) throw new Error(`No legal documents found under ${opts.dir} (expected en/*.md and zh/*.md)`);
  const chunks = docs.flatMap(chunkDoc);
  const unpaired = unpairedSlugs(docs);
  log(`${docs.length} documents, ${chunks.length} chunks${dryRun ? " (dry run: no database access)" : ""}`);
  for (const u of unpaired) log(`warning: ${u}`);

  if (dryRun) {
    // Exercise the embedding step with deterministic vectors so a dry run checks the whole path offline.
    await embedAll(
      chunks.map((c) => c.content),
      async (t) => t.map(mockEmbedding),
    );
    return { dryRun, docs: docs.length, chunks: chunks.length, embedded: chunks.length, unchanged: 0, staleDeleted: 0, missingDeleted: 0, unpaired };
  }

  const store = opts.store;
  if (!store) throw new Error("runIngest: a store is required unless dryRun is set");
  const embedMany = opts.embedMany ?? ((t: string[]) => providerEmbedMany(t, { task: "document" }));
  const modelId = opts.embeddingModelId ?? embeddingModelId();
  for (const c of chunks) c.content_hash = hashWithEmbeddingModel(c.content_hash, modelId);
  log(`embedding model: ${modelId}`);

  const existing = await store.getChunkHashes();
  const changed = chunks.filter((c) => opts.force || existing.get(key(c)) !== c.content_hash);
  log(`${changed.length} to embed, ${chunks.length - changed.length} unchanged`);

  const embeddings = await embedAll(
    changed.map((c) => c.content),
    embedMany,
  );
  const rows: LegalChunkInsert[] = changed.map((c, i) => ({ ...c, embedding: embeddings[i]! }));
  if (rows.length) await store.upsertLegalChunks(rows);

  let staleDeleted = 0;
  for (const d of docs) {
    const count = chunks.filter((c) => c.doc_slug === d.slug && c.lang === d.lang).length;
    staleDeleted += await store.deleteStaleChunks(d.slug, d.lang, count);
  }
  const missingDeleted = await store.deleteMissingDocs(docs.map((d) => ({ doc_slug: d.slug, lang: d.lang })));
  log(`upserted ${rows.length}, deleted ${staleDeleted} stale chunks and ${missingDeleted} chunks of removed documents`);

  return {
    dryRun,
    docs: docs.length,
    chunks: chunks.length,
    embedded: rows.length,
    unchanged: chunks.length - changed.length,
    staleDeleted,
    missingDeleted,
    unpaired,
  };
}
