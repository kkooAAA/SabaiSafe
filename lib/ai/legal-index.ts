// In-memory legal search for sample mode (no Supabase, contracts §1). lib/db's matchLegal returns [] in sample
// mode, so the Legal Guide searches content/legal directly: the same chunks ingest would store (legal-content.ts),
// embedded with the active embedding provider (mock in tests/CI, else EMBEDDING_PROVIDER), ranked by cosine
// similarity like match_legal. Built once per process and cached.
import type { UiLang } from "@/types/api";
import type { LegalMatchRow } from "@/types/db";
import { chunkDoc, legalContentDir, loadLegalDocs, type LegalChunk } from "./legal-content";
import { embedMany, embeddingModelId } from "./provider";

type Index = { chunks: LegalChunk[]; embeddings: number[][] };

const cache = new Map<string, Promise<Index>>();

async function build(dir: string): Promise<Index> {
  const chunks = loadLegalDocs(dir).flatMap(chunkDoc);
  const embeddings = await embedMany(
    chunks.map((c) => c.content),
    { task: "document" },
  );
  return { chunks, embeddings };
}

function getIndex(): Promise<Index> {
  const dir = legalContentDir();
  // Keyed by vector space: an index built with one embedding model is never queried with another's vectors.
  const key = `${embeddingModelId()}|${dir}`;
  let p = cache.get(key);
  if (!p) {
    p = build(dir);
    cache.set(key, p);
    // A failed build (e.g. embedding API down) must not be cached forever.
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** Tests only: forget the cached index (e.g. after changing LEGAL_CONTENT_DIR). */
export function resetSampleIndex(): void {
  cache.clear();
}

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * (b[i] ?? 0);
  return s;
}

const norm = (v: readonly number[]) => Math.sqrt(dot(v, v)) || 1;

/** Same contract as lib/db matchLegal (§2.2): lang filter (null = all), ordered by similarity, cap 20. */
export async function matchSample(embedding: number[], count: number, lang: UiLang | null): Promise<LegalMatchRow[]> {
  const { chunks, embeddings } = await getIndex();
  const qn = norm(embedding);
  const scored: LegalMatchRow[] = [];
  chunks.forEach((c, i) => {
    if (lang && c.lang !== lang) return;
    const e = embeddings[i]!;
    scored.push({
      id: i + 1, // stable for a given content set; sample ids are not DB ids
      doc_slug: c.doc_slug,
      chunk_index: c.chunk_index,
      lang: c.lang,
      title: c.title,
      law: c.law,
      law_th: c.law_th,
      section: c.section,
      location: c.location,
      source_url: c.source_url,
      topic: c.topic,
      status: c.status,
      heading: c.heading,
      content: c.content,
      similarity: dot(embedding, e) / (qn * norm(e)),
    });
  });
  scored.sort((a, b) => b.similarity - a.similarity || a.id - b.id);
  return scored.slice(0, Math.min(Math.max(Math.trunc(count) || 1, 1), 20));
}
