// lib/ai/ingest.ts runIngest with an in-memory store (P2-2, contracts §2.1): hash skip, stale delete,
// missing-doc delete, dry run, safety checks. No Supabase, no API keys.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UiLang } from "@/types/api";
import type { LegalChunkInsert } from "@/types/db";
import { runIngest, type IngestStore } from "@/lib/ai/ingest";
import { mockEmbedding } from "@/lib/ai/provider";

const root = mkdtempSync(join(tmpdir(), "sabaisafe-ingest-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fm = (lang: UiLang, status = "DRAFT") =>
  `---\ntitle: "${lang === "zh" ? "出租车" : "Taxi"}"\nlaw: "Act"\nlaw_th: ""\nsection: "TO VERIFY"\nlocation: "Phuket"\nlang: "${lang}"\nsource_url: ""\nstatus: "${status}"\ntopic: "transport"\nupdated: "2026-11-15"\n---\n`;
const body = (n: number) => `# T\n\n${Array.from({ length: n }, (_, i) => `## Part ${i}\n\nText ${i}.\n`).join("\n")}`;

function write(dir: string, lang: UiLang, slug: string, sections: number, status = "DRAFT") {
  mkdirSync(join(dir, lang), { recursive: true });
  writeFileSync(join(dir, lang, `${slug}.md`), fm(lang, status) + body(sections));
}

class MemStore implements IngestStore {
  rows = new Map<string, LegalChunkInsert>();
  upserts = 0;
  k = (r: { doc_slug: string; lang: string; chunk_index: number }) => `${r.doc_slug}|${r.lang}|${r.chunk_index}`;
  async getChunkHashes() {
    return new Map([...this.rows].map(([k, r]) => [k, r.content_hash]));
  }
  async upsertLegalChunks(rows: LegalChunkInsert[]) {
    this.upserts += rows.length;
    for (const r of rows) this.rows.set(this.k(r), r);
  }
  async deleteStaleChunks(doc_slug: string, lang: UiLang, keepCount: number) {
    let n = 0;
    for (const [k, r] of this.rows) if (r.doc_slug === doc_slug && r.lang === lang && r.chunk_index >= keepCount) {
        this.rows.delete(k);
        n++;
      }
    return n;
  }
  async deleteMissingDocs(present: { doc_slug: string; lang: UiLang }[]) {
    const keep = new Set(present.map((p) => `${p.doc_slug}|${p.lang}`));
    let n = 0;
    for (const [k, r] of this.rows) if (!keep.has(`${r.doc_slug}|${r.lang}`)) {
        this.rows.delete(k);
        n++;
      }
    return n;
  }
}

const embedMany = vi.fn(async (t: string[]) => t.map(mockEmbedding));

describe("runIngest", () => {
  let dir: string;
  let store: MemStore;
  beforeEach(() => {
    dir = mkdtempSync(join(root, "c-"));
    store = new MemStore();
    embedMany.mockClear();
    write(dir, "en", "taxi", 3);
    write(dir, "zh", "taxi", 3);
    write(dir, "en", "drones", 2);
    write(dir, "zh", "drones", 2);
  });

  it("first run embeds and upserts every chunk with 1536-dim vectors", async () => {
    const r = await runIngest({ dir, store, embedMany });
    expect(r).toMatchObject({ dryRun: false, docs: 4, chunks: 10, embedded: 10, unchanged: 0, staleDeleted: 0, missingDeleted: 0, unpaired: [] });
    expect(store.rows.size).toBe(10);
    for (const row of store.rows.values()) {
      expect(row.embedding).toHaveLength(1536);
      expect(row.status).toBe("DRAFT");
    }
  });

  it("second run with no changes embeds nothing", async () => {
    await runIngest({ dir, store, embedMany });
    embedMany.mockClear();
    const r = await runIngest({ dir, store, embedMany });
    expect(r).toMatchObject({ embedded: 0, unchanged: 10 });
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("--force re-embeds everything", async () => {
    await runIngest({ dir, store, embedMany });
    expect((await runIngest({ dir, store, embedMany, force: true })).embedded).toBe(10);
  });

  it("DRAFT -> VERIFIED changes the hash and re-embeds that doc only", async () => {
    await runIngest({ dir, store, embedMany });
    write(dir, "en", "taxi", 3, "VERIFIED");
    const r = await runIngest({ dir, store, embedMany });
    expect(r).toMatchObject({ embedded: 3, unchanged: 7 });
    expect(store.rows.get("taxi|en|0")?.status).toBe("VERIFIED");
  });

  it("a shorter document deletes its stale chunks", async () => {
    await runIngest({ dir, store, embedMany });
    write(dir, "en", "taxi", 1);
    const r = await runIngest({ dir, store, embedMany });
    expect(r.staleDeleted).toBe(2);
    expect([...store.rows.keys()].filter((k) => k.startsWith("taxi|en|"))).toEqual(["taxi|en|0"]);
    expect([...store.rows.keys()].filter((k) => k.startsWith("taxi|zh|"))).toHaveLength(3);
  });

  it("a removed document is deleted; an unpaired slug is reported", async () => {
    await runIngest({ dir, store, embedMany });
    unlinkSync(join(dir, "zh", "drones.md"));
    const r = await runIngest({ dir, store, embedMany });
    expect(r.missingDeleted).toBe(2);
    expect(r.unpaired).toEqual(["drones (en only)"]);
    expect([...store.rows.keys()].some((k) => k.startsWith("drones|zh|"))).toBe(false);
  });

  it("refuses an empty content dir (would wipe the table via deleteMissingDocs)", async () => {
    const empty = mkdtempSync(join(root, "empty-"));
    const spy = vi.spyOn(store, "deleteMissingDocs");
    await expect(runIngest({ dir: empty, store, embedMany })).rejects.toThrow(/No legal documents/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("invalid frontmatter fails before any DB write", async () => {
    await runIngest({ dir, store, embedMany });
    writeFileSync(join(dir, "en", "bad.md"), fm("en").replace('status: "DRAFT"', 'status: "FINAL"') + body(1));
    const spy = vi.spyOn(store, "upsertLegalChunks");
    await expect(runIngest({ dir, store, embedMany, force: true })).rejects.toThrow(/bad\.md/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a wrong-sized embedding or count fails before upsert", async () => {
    const spy = vi.spyOn(store, "upsertLegalChunks");
    await expect(runIngest({ dir, store, embedMany: async (t) => t.map(() => [0.1, 0.2]) })).rejects.toThrow(/dims/);
    await expect(runIngest({ dir, store, embedMany: async () => [] })).rejects.toThrow(/vectors/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("dry run: no store, no provider embedder, full chunk count", async () => {
    const r = await runIngest({ dir, dryRun: true, embedMany });
    expect(r).toMatchObject({ dryRun: true, docs: 4, chunks: 10 });
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("non-dry run without a store throws", async () => {
    await expect(runIngest({ dir, embedMany })).rejects.toThrow(/store/);
  });

  it("dry run over the real content/legal succeeds", async () => {
    const r = await runIngest({ dir: join(process.cwd(), "content", "legal"), dryRun: true });
    expect(r.docs).toBeGreaterThanOrEqual(32);
    expect(r.unpaired).toEqual([]);
    expect(r.chunks).toBeGreaterThanOrEqual(r.docs * 2);
  });
});
