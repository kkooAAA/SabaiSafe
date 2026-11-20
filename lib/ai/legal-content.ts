// Legal content parsing and chunking (contracts §2.1, §5). Shared by scripts/ingest.ts and the in-memory
// sample-mode index (lib/ai/legal-index.ts), so both see exactly the same chunks.
// Pure apart from reading files; no Next or DB imports, so it runs under tsx and Vitest.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import type { LegalTopic, UiLang } from "@/types/api";

export const LEGAL_TOPICS = [
  "scam",
  "price",
  "transport",
  "rental",
  "alcohol_drugs",
  "beach_rules",
  "accommodation",
  "police_procedure",
  "visa_immigration",
  "other",
] as const satisfies readonly LegalTopic[];

export const LEGAL_LANGS = ["en", "zh"] as const satisfies readonly UiLang[];

/** Sections longer than this (in "word units", see wordUnits) are sub-split at paragraph boundaries. */
export const MAX_CHUNK_UNITS = 500;

const emptyToNull = (v: string) => (v.trim() === "" ? null : v.trim());
const req = z.string().trim().min(1);
const opt = z.string().transform(emptyToNull);

/** Frontmatter per contracts §5. Every value is a quoted string; "" means null for the optional ones. */
export const LegalFrontmatter = z.object({
  title: req,
  law: req,
  law_th: opt.optional().transform((v) => v ?? null),
  section: opt.optional().transform((v) => v ?? null),
  location: opt.optional().transform((v) => v ?? null),
  lang: z.enum(LEGAL_LANGS),
  source_url: opt.optional().transform((v) => v ?? null),
  status: z.enum(["DRAFT", "VERIFIED"]),
  topic: z.enum(LEGAL_TOPICS),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be a quoted YYYY-MM-DD string"),
  verify_priority: z.literal("high").optional(),
});
export type LegalFrontmatter = z.infer<typeof LegalFrontmatter>;

export type LegalDoc = { slug: string; lang: UiLang; file: string; meta: LegalFrontmatter; body: string };

/** One chunk as it is stored in legal_chunks (minus the embedding). */
export type LegalChunk = {
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
  status: "DRAFT" | "VERIFIED";
  heading: string | null;
  /** Title + heading prefix, a blank line, then the section text. */
  content: string;
  content_hash: string;
};

export class LegalContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegalContentError";
  }
}

/** Parses one Markdown file. Throws LegalContentError on invalid frontmatter or a lang/folder mismatch. */
export function parseLegalDoc(text: string, file: string, folderLang: UiLang): LegalDoc {
  let parsed: matter.GrayMatterFile<string>;
  try {
    // Fresh options object: gray-matter caches by content when called with no options.
    parsed = matter(text.replace(/^﻿/, ""), {});
  } catch (err) {
    throw new LegalContentError(`${file}: frontmatter is not valid YAML (${(err as Error).message})`);
  }
  const meta = LegalFrontmatter.safeParse(parsed.data);
  if (!meta.success) {
    const issues = meta.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new LegalContentError(`${file}: invalid frontmatter (${issues})`);
  }
  if (meta.data.lang !== folderLang) {
    throw new LegalContentError(`${file}: lang "${meta.data.lang}" does not match folder "${folderLang}"`);
  }
  const slug = path.basename(file, ".md");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new LegalContentError(`${file}: slug must be kebab-case`);
  return { slug, lang: folderLang, file, meta: meta.data, body: parsed.content };
}

/** Reads content/legal/{en,zh}/*.md (sorted, so ordering is deterministic). Missing folders are skipped. */
export function loadLegalDocs(root: string): LegalDoc[] {
  const docs: LegalDoc[] = [];
  for (const lang of LEGAL_LANGS) {
    const dir = path.join(root, lang);
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      docs.push(parseLegalDoc(readFileSync(file, "utf8"), file, lang));
    }
  }
  return docs;
}

/** Size measure for chunking: a latin word counts 1, a CJK/Thai character counts 0.5 (~1000 zh chars per 500 units). */
export function wordUnits(s: string): number {
  const latin = s.match(/[A-Za-z0-9À-ɏ'’-]+/g)?.length ?? 0;
  const cjk = s.match(/[㐀-鿿豈-﫿฀-๿]/gu)?.length ?? 0;
  return latin + cjk * 0.5;
}

export type Section = { heading: string | null; text: string };

/**
 * Splits a Markdown body on lines starting with "## ". Text before the first "##" (the "#" title) is dropped
 * when there is at least one "##"; a body without "##" becomes one section with heading null.
 */
export function splitSections(body: string): Section[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const sections: Section[] = [];
  let current: { heading: string | null; lines: string[] } | null = null;
  const preamble: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      current = { heading: line.slice(3).trim(), lines: [] };
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
  if (sections.length === 0) {
    const text = preamble.filter((l) => !/^#\s/.test(l)).join("\n").trim();
    return text ? [{ heading: null, text }] : [];
  }
  return sections.filter((s) => s.text.length > 0);
}

/** Splits text into pieces of at most `max` units at paragraph (then sentence) boundaries. */
export function subSplit(text: string, max = MAX_CHUNK_UNITS): string[] {
  if (wordUnits(text) <= max) return [text];
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paras) {
    if (wordUnits(p) <= max) pieces.push(p);
    else pieces.push(...splitSentences(p, max));
  }
  // Greedy packing of pieces into chunks, aiming for even sizes.
  const total = pieces.reduce((n, p) => n + wordUnits(p), 0);
  const target = total / Math.ceil(total / max);
  const out: string[] = [];
  let buf: string[] = [];
  let size = 0;
  for (const p of pieces) {
    const u = wordUnits(p);
    if (buf.length && (size + u > max || size >= target)) {
      out.push(buf.join("\n\n"));
      buf = [];
      size = 0;
    }
    buf.push(p);
    size += u;
  }
  if (buf.length) out.push(buf.join("\n\n"));
  return out;
}

function splitSentences(p: string, max: number): string[] {
  const sentences = p.match(/[^.!?。！？]+[.!?。！？]*\s*/gu) ?? [p];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && wordUnits(buf + s) > max) {
      out.push(buf.trim());
      buf = "";
    }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** sha256 of the chunk content plus the frontmatter fields that change what the UI/model shows (§2.1). */
export function contentHash(
  content: string,
  meta: Pick<LegalChunk, "status" | "section" | "law" | "law_th" | "source_url" | "location" | "topic">,
): string {
  const fields = [meta.status, meta.section, meta.law, meta.law_th, meta.source_url, meta.location, meta.topic];
  return createHash("sha256").update(content).update("\u0000").update(JSON.stringify(fields)).digest("hex");
}

/** Prefix that goes in front of every chunk's text (better embeddings). excerptOf() removes it again. */
export function chunkPrefix(title: string, heading: string | null): string {
  return heading ? `${title}\n${heading}` : title;
}

/** Turns one document into its chunks, chunk_index 0..n-1 in document order. */
export function chunkDoc(doc: LegalDoc): LegalChunk[] {
  const { meta } = doc;
  const chunks: LegalChunk[] = [];
  for (const section of splitSections(doc.body)) {
    for (const piece of subSplit(section.text)) {
      const content = `${chunkPrefix(meta.title, section.heading)}\n\n${piece}`;
      const fields = {
        status: meta.status,
        section: meta.section,
        law: meta.law,
        law_th: meta.law_th,
        source_url: meta.source_url,
        location: meta.location,
        topic: meta.topic,
      };
      chunks.push({
        doc_slug: doc.slug,
        chunk_index: chunks.length,
        lang: doc.lang,
        title: meta.title,
        heading: section.heading,
        content,
        content_hash: contentHash(content, fields),
        ...fields,
      });
    }
  }
  return chunks;
}

/** The chunk text without its title/heading prefix, whitespace-collapsed, at most `max` characters. */
export function excerptOf(content: string, max = 300): string {
  const i = content.indexOf("\n\n");
  const text = (i >= 0 ? content.slice(i + 2) : content).replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

/** Default content root: <cwd>/content/legal (override with LEGAL_CONTENT_DIR, e.g. for tests). */
export function legalContentDir(): string {
  return path.resolve(process.cwd(), process.env.LEGAL_CONTENT_DIR?.trim() || path.join("content", "legal"));
}
