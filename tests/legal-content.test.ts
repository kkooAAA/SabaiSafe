// lib/ai/legal-content.ts: frontmatter parsing, chunking, hashing, excerpts (P2-2, contracts §2.1 / §5).
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  LegalContentError,
  chunkDoc,
  contentHash,
  excerptOf,
  loadLegalDocs,
  parseLegalDoc,
  splitSections,
  subSplit,
  wordUnits,
} from "@/lib/ai/legal-content";

const fm = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    title: "Taxi fares",
    law: "Land Transport Act B.E. 2522",
    law_th: "พ.ร.บ.การขนส่งทางบก พ.ศ. 2522",
    section: "TO VERIFY",
    location: "Phuket",
    lang: "en",
    source_url: "",
    status: "DRAFT",
    topic: "transport",
    updated: "2026-11-15",
    ...over,
  };
  return `---\n${Object.entries(base).map(([k, v]) => `${k}: "${v}"`).join("\n")}\n---\n`;
};
const BODY = "# Taxi fares\n\nIntro line.\n\n## Summary\n\nUse the meter.\n\n## What you can do\n\nCall 1155.\n";

describe("parseLegalDoc", () => {
  it("parses frontmatter, maps empty strings to null, keeps DRAFT", () => {
    const d = parseLegalDoc(fm() + BODY, "content/legal/en/taxi-fares.md", "en");
    expect(d.slug).toBe("taxi-fares");
    expect(d.meta.status).toBe("DRAFT");
    expect(d.meta.source_url).toBeNull();
    expect(d.meta.section).toBe("TO VERIFY");
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseLegalDoc("﻿" + fm() + BODY, "x/en/a.md", "en").slug).toBe("a");
  });

  it.each([
    ["lang/folder mismatch", fm({ lang: "zh" }), "en"],
    ["bad topic", fm({ topic: "nightlife" }), "en"],
    ["bad status", fm({ status: "FINAL" }), "en"],
    ["unquoted date", fm().replace('updated: "2026-11-15"', "updated: 2026-11-15"), "en"],
    ["empty title", fm({ title: " " }), "en"],
  ] as const)("rejects %s", (_n, head, lang) => {
    expect(() => parseLegalDoc(head + BODY, "x/en/a.md", lang)).toThrow(LegalContentError);
  });

  it("rejects a non-kebab slug", () => {
    expect(() => parseLegalDoc(fm() + BODY, "x/en/Taxi_Fares.md", "en")).toThrow(/kebab/);
  });
});

describe("splitSections / subSplit", () => {
  it("splits on ## lines and drops the # title preamble", () => {
    const s = splitSections(BODY);
    expect(s.map((x) => x.heading)).toEqual(["Summary", "What you can do"]);
    expect(s[0]?.text).toBe("Use the meter.");
  });

  it("does not split on ### or on ## inside a line", () => {
    const s = splitSections("## A\n\ntext ## not a heading\n### Sub\nmore\n## B\n\nb");
    expect(s.map((x) => x.heading)).toEqual(["A", "B"]);
    expect(s[0]?.text).toContain("### Sub");
  });

  it("handles CRLF line endings", () => {
    expect(splitSections(BODY.replace(/\n/g, "\r\n")).map((x) => x.heading)).toEqual(["Summary", "What you can do"]);
  });

  it("a body without ## becomes one section", () => {
    expect(splitSections("# T\n\nJust text.")).toEqual([{ heading: null, text: "Just text." }]);
  });

  it("wordUnits counts latin words 1 and CJK chars 0.5", () => {
    expect(wordUnits("use the meter")).toBe(3);
    expect(wordUnits("出租车")).toBe(1.5);
  });

  it("sub-splits long sections at paragraph boundaries, each piece <= max", () => {
    const para = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const text = [para(200), para(200), para(200)].join("\n\n");
    const pieces = subSplit(text, 500);
    expect(pieces.length).toBe(2);
    for (const p of pieces) expect(wordUnits(p)).toBeLessThanOrEqual(500);
    expect(pieces.join("\n\n")).toBe(text);
  });

  it("splits a single oversized zh paragraph at sentence ends", () => {
    const text = "出租车必须按表收费。".repeat(150); // 1350 chars = 675 units
    const pieces = subSplit(text, 500);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(wordUnits(p)).toBeLessThanOrEqual(500);
    expect(pieces.join("")).toBe(text);
  });
});

describe("chunkDoc / contentHash", () => {
  const doc = parseLegalDoc(fm() + BODY, "x/en/taxi-fares.md", "en");

  it("chunk_index is 0..n-1, content is prefixed by title + heading, status/section passed through", () => {
    const c = chunkDoc(doc);
    expect(c.map((x) => x.chunk_index)).toEqual([0, 1]);
    expect(c[0]?.content).toBe("Taxi fares\nSummary\n\nUse the meter.");
    expect(c[0]).toMatchObject({ doc_slug: "taxi-fares", lang: "en", status: "DRAFT", section: "TO VERIFY", topic: "transport", heading: "Summary" });
    expect(c[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(chunkDoc(doc)).toEqual(chunkDoc(parseLegalDoc(fm() + BODY, "x/en/taxi-fares.md", "en")));
  });

  it.each(["status", "section", "law", "law_th", "source_url", "location", "topic"] as const)("hash changes when %s changes", (k) => {
    const over: Record<string, string> = {
      status: "VERIFIED",
      section: "Section 1",
      law: "Other Act",
      law_th: "อื่น",
      source_url: "https://example.org",
      location: "Patong",
      topic: "price",
    };
    const other = chunkDoc(parseLegalDoc(fm({ [k]: over[k]! }) + BODY, "x/en/taxi-fares.md", "en"));
    expect(other[0]?.content_hash).not.toBe(chunkDoc(doc)[0]?.content_hash);
  });

  it("hash ignores fields that don't change the chunk (updated, verify_priority)", () => {
    const other = parseLegalDoc(fm({ updated: "2027-01-01" }) + BODY, "x/en/taxi-fares.md", "en");
    expect(chunkDoc(other)[0]?.content_hash).toBe(chunkDoc(doc)[0]?.content_hash);
  });

  it("hash distinguishes null from the string \"null\"", () => {
    const base = { status: "DRAFT", section: null, law: "L", law_th: null, source_url: null, location: null, topic: "other" } as const;
    expect(contentHash("x", base)).not.toBe(contentHash("x", { ...base, section: "null" }));
  });
});

describe("excerptOf", () => {
  it("drops the prefix, collapses whitespace, caps at 300 chars with an ellipsis", () => {
    expect(excerptOf("Title\nHeading\n\nUse   the\nmeter.")).toBe("Use the meter.");
    const long = excerptOf("T\n\n" + "出".repeat(400));
    expect(Array.from(long)).toHaveLength(300);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("real content/legal", () => {
  const docs = loadLegalDocs(join(process.cwd(), "content", "legal"));

  it("loads all docs without errors, en and zh", () => {
    expect(docs.filter((d) => d.lang === "en").length).toBeGreaterThan(0);
    expect(docs.filter((d) => d.lang === "zh").length).toBe(docs.filter((d) => d.lang === "en").length);
  });

  it("every chunk is DRAFT (AI-written), within size, with a heading and a unique key", () => {
    const keys = new Set<string>();
    for (const d of docs) {
      for (const c of chunkDoc(d)) {
        expect(c.status, d.file).toBe("DRAFT");
        expect(c.heading, d.file).not.toBeNull();
        expect(wordUnits(c.content), `${d.file}#${c.chunk_index}`).toBeLessThanOrEqual(520); // 500 + prefix
        const k = `${c.doc_slug}|${c.lang}|${c.chunk_index}`;
        expect(keys.has(k), k).toBe(false);
        keys.add(k);
      }
    }
  });
});
