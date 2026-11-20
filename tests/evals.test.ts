// evals/questions.jsonl shape + evals/score.ts scoring rules (P2-5).
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DISCLAIMER } from "@/lib/ai/prompts";
import { NO_ANSWER_MESSAGE } from "@/lib/ai/constants";
import type { ChatTrailer, LegalSource } from "@/types/api";
import { ERROR_MARKER, SOURCES_DELIMITER } from "@/types/protocol";
import { loadQuestions } from "@/evals/run";
import { citationsIn, hardFailures, languageOk, parseChatStream, scoreAnswer, summarize, type EvalQuestion } from "@/evals/score";

const questions = loadQuestions();
const slugs = (lang: string) =>
  existsSync(join("content", "legal", lang)) ? readdirSync(join("content", "legal", lang)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")) : [];

describe("evals/questions.jsonl", () => {
  it("has 40 questions, 20 en and 20 zh, unique ids", () => {
    expect(questions).toHaveLength(40);
    expect(questions.filter((q) => q.lang === "en")).toHaveLength(20);
    expect(questions.filter((q) => q.lang === "zh")).toHaveLength(20);
    expect(new Set(questions.map((q) => q.id)).size).toBe(40);
    for (const q of questions) expect(q.id.startsWith(`${q.lang}-`), q.id).toBe(true);
  });

  it("questions are in their own language and within the API limit", () => {
    for (const q of questions) {
      expect(q.question.length, q.id).toBeGreaterThan(5);
      expect(q.question.length, q.id).toBeLessThanOrEqual(1000);
      expect(/[一-鿿]/.test(q.question), q.id).toBe(q.lang === "zh");
    }
  });

  it("every expected slug exists in content/legal/<lang>", () => {
    for (const q of questions) for (const s of q.expected_slugs) expect(slugs(q.lang), `${q.id}: ${s}`).toContain(s);
  });

  it("covers every topic file in both languages", () => {
    for (const lang of ["en", "zh"] as const) {
      const covered = new Set(questions.filter((q) => q.lang === lang).flatMap((q) => q.expected_slugs));
      expect(slugs(lang).filter((s) => !covered.has(s)), lang).toEqual([]);
    }
  });

  it("has out-of-scope (no-answer) and emergency questions in each language", () => {
    for (const lang of ["en", "zh"] as const) {
      const qs = questions.filter((q) => q.lang === lang);
      const oos = qs.filter((q) => q.expect_no_answer);
      expect(oos.length, lang).toBeGreaterThanOrEqual(2);
      for (const q of oos) expect(q.expected_slugs, q.id).toEqual([]);
      for (const q of qs.filter((x) => !x.expect_no_answer)) expect(q.expected_slugs.length, q.id).toBeGreaterThan(0);
      expect(qs.some((q) => q.expect_emergency), lang).toBe(true);
    }
  });
});

// ---------- scoring ----------
const src = (id: number, doc_slug: string, excerpt = "Excerpt."): LegalSource => ({
  id,
  chunk_id: 100 + id,
  doc_slug,
  title: doc_slug,
  law: "Some Act",
  law_th: null,
  section: "TO VERIFY",
  location: "Phuket",
  source_url: null,
  status: "DRAFT",
  similarity: 0.8,
  excerpt,
});
const body = (answer: string, sources: LegalSource[], meta: Partial<ChatTrailer["meta"]> = {}) =>
  answer + SOURCES_DELIMITER + JSON.stringify({ sources, meta: { is_emergency: false, no_answer: false, topic: "rental", location: null, ...meta } }) + "\n";

const qEn: EvalQuestion = { id: "en-x", lang: "en", question: "q", expected_slugs: ["taxi-tuk-tuk-fares"] };
const qZh: EvalQuestion = { id: "zh-x", lang: "zh", question: "问", expected_slugs: ["taxi-tuk-tuk-fares"] };
const qOos: EvalQuestion = { id: "en-o", lang: "en", question: "q", expected_slugs: [], expect_no_answer: true };

describe("evals/score parseChatStream", () => {
  it("splits on the first delimiter and parses the trailer", () => {
    const p = parseChatStream(body("Answer [1].", [src(1, "a")]));
    expect(p).toMatchObject({ answer: "Answer [1].", complete: true, trailerValid: true, error: false });
    expect(p.trailer?.sources[0]?.doc_slug).toBe("a");
  });
  it("flags a missing delimiter as incomplete, ERROR_MARKER as error, bad JSON as invalid trailer", () => {
    expect(parseChatStream("partial")).toMatchObject({ complete: false, error: false });
    expect(parseChatStream(`partial${ERROR_MARKER}`)).toMatchObject({ answer: "partial", complete: false, error: true });
    expect(parseChatStream(`a${SOURCES_DELIMITER}{nope`)).toMatchObject({ complete: true, trailerValid: false });
  });
});

describe("evals/score helpers", () => {
  it("languageOk", () => {
    expect(languageOk("Taxis must use the meter [1]. TO VERIFY", "en")).toBe(true);
    expect(languageOk("出租车必须打表 [1]。待核实（TO VERIFY）", "zh")).toBe(true);
    expect(languageOk("Taxis must use the meter.", "zh")).toBe(false);
    expect(languageOk("出租车必须打表。", "en")).toBe(false);
    expect(languageOk("", "en")).toBe(false);
  });
  it("citationsIn", () => {
    expect(citationsIn("a [1] b [2][3] c [x]")).toEqual([1, 2, 3]);
  });
});

describe("evals/score scoreAnswer", () => {
  it("passes a good cited en answer", () => {
    const s = scoreAnswer(qEn, 200, body(`Use the meter [1]. Call 1155.\n\n${DISCLAIMER.en}`, [src(1, "taxi-tuk-tuk-fares")]));
    expect(s.failures).toEqual([]);
    expect(s).toMatchObject({ hit: true, hit_rank: 1, citations: true, disclaimer: true, language: true, draft_sources: 1 });
  });
  it("records a miss, a missing disclaimer, a dangling citation and wrong language", () => {
    const s = scoreAnswer(qZh, 200, body("Use the meter [3].", [src(1, "drones")]));
    expect(s.hit).toBe(false);
    expect(s.citations).toBe(false);
    expect(s.disclaimer).toBe(false);
    expect(s.language).toBe(false);
    expect(s.failures.length).toBeGreaterThanOrEqual(4);
  });
  it("flags invented phone numbers but allows hotlines and numbers in the sources", () => {
    const ok = scoreAnswer(qEn, 200, body(`Call 1155 or 076 211 036 [1].\n${DISCLAIMER.en}`, [src(1, "taxi-tuk-tuk-fares", "Office 076 211 036")]));
    expect(ok.invented_numbers).toEqual([]);
    const bad = scoreAnswer(qEn, 200, body(`Call 081 234 5678 [1].\n${DISCLAIMER.en}`, [src(1, "taxi-tuk-tuk-fares")]));
    expect(bad.invented_numbers).toEqual(["0812345678"]);
  });
  it("out-of-scope: the no-answer path passes, an answer fails", () => {
    const na = scoreAnswer(qOos, 200, body(NO_ANSWER_MESSAGE.en, [], { no_answer: true }));
    expect(na.failures).toEqual([]);
    expect(na).toMatchObject({ hit: null, no_answer_ok: true, citations: null });
    const answered = scoreAnswer(qOos, 200, body(`Try Luigi's [1].\n${DISCLAIMER.en}`, [src(1, "drones")]));
    expect(answered.no_answer_ok).toBe(false);
  });
  it("zh no-answer message passes the zh language and disclaimer checks", () => {
    const s = scoreAnswer({ ...qOos, lang: "zh", id: "zh-o" }, 200, body(NO_ANSWER_MESSAGE.zh, [], { no_answer: true }));
    expect(s.failures).toEqual([]);
  });
  it("emergency flag is checked only when expected", () => {
    const q = { ...qEn, expect_emergency: true };
    expect(scoreAnswer(q, 200, body(`x [1]\n${DISCLAIMER.en}`, [src(1, "taxi-tuk-tuk-fares")])).emergency_ok).toBe(false);
    expect(scoreAnswer(q, 200, body(`x [1]\n${DISCLAIMER.en}`, [src(1, "taxi-tuk-tuk-fares")], { is_emergency: true })).emergency_ok).toBe(true);
  });
  it("non-200 and stream errors fail", () => {
    expect(scoreAnswer(qEn, 503, '{"error":{}}').failures).toContain("http 503");
    expect(scoreAnswer(qEn, 200, `x${ERROR_MARKER}`).failures).toContain("stream error");
  });
});

describe("evals/score summarize", () => {
  it("computes rates and hard gates", () => {
    const good = scoreAnswer(qEn, 200, body(`Meter [1].\n${DISCLAIMER.en}`, [src(1, "drones"), src(2, "taxi-tuk-tuk-fares")]));
    const miss = scoreAnswer(qEn, 200, body(`Meter [1].\n${DISCLAIMER.en}`, [src(1, "drones")]));
    const oos = scoreAnswer(qOos, 200, body(NO_ANSWER_MESSAGE.en, [], { no_answer: true }));
    const sum = summarize([good, miss, oos]);
    expect(sum).toMatchObject({ total: 3, in_scope: 2, hit_rate: 0.5, oos_no_answer_rate: 1, disclaimer_rate: 1, citation_rate: 1 });
    expect(sum.mrr).toBeCloseTo(0.25);
    expect(hardFailures(sum)).toEqual([]);
    const broken = summarize([scoreAnswer(qEn, 200, "Meter.")]);
    expect(hardFailures(broken).length).toBeGreaterThanOrEqual(2);
  });
});
