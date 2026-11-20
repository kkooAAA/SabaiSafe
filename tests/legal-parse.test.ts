// components/legal/parse.ts: Legal Guide stream parsing, citation links, disclaimer strip (P2-4, contracts §3.1).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DISCLAIMER } from "@/lib/ai/prompts";
import { ERROR_MARKER, SOURCES_DELIMITER } from "@/types/protocol";
import { linkCitations, looksUrgent, parseLegalStream, parseTrailer, showSection, sourceAnchor, stripDisclaimer } from "@/components/legal/parse";

const src = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  chunk_id: 10 + id,
  doc_slug: "taxi-tuk-tuk-fares",
  title: `T${id}`,
  law: "Act",
  law_th: null,
  section: "TO VERIFY",
  location: "Phuket",
  source_url: null,
  status: "DRAFT",
  similarity: 0.7,
  excerpt: "e",
  ...extra,
});
const trailer = (sources: unknown[], meta: Record<string, unknown> = {}) =>
  JSON.stringify({ sources, meta: { is_emergency: false, no_answer: false, topic: "transport", location: null, ...meta } });

describe("parseLegalStream", () => {
  it("complete stream", () => {
    const p = parseLegalStream(`Answer [1].${SOURCES_DELIMITER}${trailer([src(1)])}\n`, true);
    expect(p.state).toBe("complete");
    expect(p.answer).toBe("Answer [1].");
    expect(p.trailer?.sources).toHaveLength(1);
  });

  it("while streaming, holds back a trailing newline and partial markers", () => {
    expect(parseLegalStream("Answer\n", false)).toMatchObject({ answer: "Answer", state: "streaming" });
    expect(parseLegalStream("Answer\n\u001eSOU", false)).toMatchObject({ answer: "Answer", state: "streaming" });
    expect(parseLegalStream("Answer\n\u001eERR", false)).toMatchObject({ answer: "Answer", state: "streaming" });
    expect(parseLegalStream(`Answer${SOURCES_DELIMITER}{"sour`, false)).toMatchObject({ answer: "Answer", trailer: null, state: "streaming" });
  });

  it("every prefix of a full body is a prefix-safe answer (no marker bytes ever shown)", () => {
    const full = `Ans [1]\nline${SOURCES_DELIMITER}${trailer([src(1)])}\n`;
    for (let i = 0; i <= full.length; i++) {
      const p = parseLegalStream(full.slice(0, i), false);
      expect(p.answer).not.toMatch(/\u001e/);
      expect("Ans [1]\nline".startsWith(p.answer), `prefix ${i}`).toBe(true);
    }
  });

  it("ERROR_MARKER before or after the delimiter => error, text before it kept", () => {
    expect(parseLegalStream(`Part${ERROR_MARKER}`, true)).toMatchObject({ answer: "Part", state: "error" });
    expect(parseLegalStream(`Part${ERROR_MARKER}`, false)).toMatchObject({ answer: "Part", state: "error" });
    expect(parseLegalStream(`Part${SOURCES_DELIMITER}${ERROR_MARKER}`, true)).toMatchObject({ state: "error" });
  });

  it("no delimiter at end => incomplete; bad JSON => bad_trailer with the answer", () => {
    expect(parseLegalStream("Cut off", true)).toMatchObject({ answer: "Cut off", state: "incomplete" });
    expect(parseLegalStream(`A${SOURCES_DELIMITER}{nope`, true)).toMatchObject({ answer: "A", trailer: null, state: "bad_trailer" });
    expect(parseLegalStream(`A${SOURCES_DELIMITER}[1,2]`, true).state).toBe("bad_trailer");
  });

  it("splits on the FIRST marker even if the trailer text contains another", () => {
    const p = parseLegalStream(`A${SOURCES_DELIMITER}${trailer([src(1, { excerpt: "x" })])}${SOURCES_DELIMITER}junk`, true);
    expect(p.answer).toBe("A");
  });
});

describe("parseTrailer", () => {
  it("anything not explicitly VERIFIED is shown as DRAFT", () => {
    const t = parseTrailer(trailer([src(1, { status: "VERIFIED" }), src(2, { status: "DRAFT" }), src(3, { status: "verified" }), src(4, { status: undefined })]));
    expect(t?.sources.map((s) => s.status)).toEqual(["VERIFIED", "DRAFT", "DRAFT", "DRAFT"]);
  });

  it("drops invalid and duplicate sources, keeps order", () => {
    const t = parseTrailer(trailer([src(2), { id: "x", title: "bad" }, src(0), src(1.5), src(2, { title: "dup" }), { id: 3 }, src(1)]));
    expect(t?.sources.map((s) => s.id)).toEqual([2, 1]);
    expect(t?.sources[0]?.title).toBe("T2");
  });

  it("normalizes meta (unknown topic => other, non-boolean flags => false)", () => {
    const t = parseTrailer(JSON.stringify({ sources: [], meta: { is_emergency: "yes", no_answer: 1, topic: "nightlife", location: 5 } }));
    expect(t?.meta).toEqual({ is_emergency: false, no_answer: false, topic: "other", location: null });
    expect(parseTrailer(JSON.stringify({ sources: [] }))?.meta.topic).toBe("other");
  });

  it("returns null for non-trailer JSON", () => {
    for (const raw of ["null", "[]", '"x"', "{}", '{"sources":{}}', ""]) expect(parseTrailer(raw), raw).toBeNull();
  });
});

describe("stripDisclaimer", () => {
  it("removes the fixed disclaimer at the end (plain, italic, quoted, blockquote)", () => {
    for (const lang of ["en", "zh"] as const) {
      const d = DISCLAIMER[lang];
      for (const tail of [d, `*${d}*`, `_${d}_`, `> ${d}`, `"${d}"`, `**${d}**  \n`]) {
        expect(stripDisclaimer(`Body [1].\n\n${tail}`, [d]), tail).toBe("Body [1].");
      }
    }
  });

  it("keeps a disclaimer that is quoted mid-sentence or followed by more text", () => {
    const d = DISCLAIMER.en;
    expect(stripDisclaimer(`Body. ${d}`, [d])).toBe(`Body. ${d}`);
    expect(stripDisclaimer(`${d}\n\nMore text.`, [d])).toBe(`${d}\n\nMore text.`);
  });

  it("the UI disclaimer string equals the server DISCLAIMER (else the UI would show it twice)", () => {
    for (const lang of ["en", "zh"] as const) {
      const msgs = JSON.parse(readFileSync(`messages/${lang}.json`, "utf8")) as { legal?: { disclaimer?: string } };
      expect(msgs.legal?.disclaimer, lang).toBe(DISCLAIMER[lang]);
    }
  });
});

describe("linkCitations", () => {
  const ids = new Set([1, 2]);
  it("links only ids present in the trailer", () => {
    expect(linkCitations("A [1] B [3].", ids)).toBe(`A [1](#${sourceAnchor(1)}) B [3].`);
  });
  it("handles lists with , ， 、 and escapes unknown ids inside a list", () => {
    expect(linkCitations("A [1, 2]", ids)).toBe("A [1](#src-1)[2](#src-2)");
    expect(linkCitations("A [1，2]", ids)).toBe("A [1](#src-1)[2](#src-2)");
    expect(linkCitations("A [1、9]", ids)).toBe("A [1](#src-1)\\[9\\]");
  });
  it("leaves Markdown links, reference definitions and code alone", () => {
    expect(linkCitations("[1](http://x)", ids)).toBe("[1](http://x)");
    expect(linkCitations("[1]: http://x", ids)).toBe("[1]: http://x");
    expect(linkCitations("`a[1]` and\n```\n[2]\n```", ids)).toBe("`a[1]` and\n```\n[2]\n```");
  });
  it("no ids => unchanged", () => {
    expect(linkCitations("A [1]", new Set())).toBe("A [1]");
  });
});

describe("showSection / looksUrgent", () => {
  it("hides TO VERIFY and empty sections", () => {
    for (const s of [null, undefined, "", "  ", "TO VERIFY", " to verify "]) expect(showSection(s)).toBe(false);
    expect(showSection("Section 4")).toBe(true);
  });
  it("flags urgent questions in en and zh, not ordinary ones", () => {
    for (const q of ["I was attacked", "my friend is drowning", "救命", "我被打了", "Emergency!"]) expect(looksUrgent(q), q).toBe(true);
    for (const q of ["Can I drink beer on the beach?", "出租车要打表吗？", "Is a 7-11 open late?"]) expect(looksUrgent(q), q).toBe(false);
  });
});
