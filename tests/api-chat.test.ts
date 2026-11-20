// POST /api/chat (Legal Guide RAG) with AI_PROVIDER=mock and sample mode (in-memory index over content/legal).
// Contracts §3.1: validation, 503, no-answer path, threshold, SOURCES trailer, DRAFT, PII scrub, ERROR_MARKER.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiError, ChatTrailer } from "@/types/api";
import { ERROR_MARKER, SOURCES_DELIMITER } from "@/types/protocol";
import { DISCLAIMER, QUERY_REWRITE_SYSTEM } from "@/lib/ai/prompts";
import { NO_ANSWER_MESSAGE } from "@/lib/ai/constants";
import { inventedNumbers } from "./helpers/phones";

// Record every prompt the mock model receives (system + user text), to prove what reaches "the provider".
const prompts: { system: string; user: string }[] = [];
vi.mock("@/lib/ai/mock-model", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/mock-model")>();
  return {
    ...actual,
    mockRespond: (prompt: Parameters<typeof actual.mockRespond>[0]) => {
      const text = (role: string) =>
        prompt
          .filter((m) => m.role === role)
          .map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")))
          .join("\n");
      prompts.push({ system: text("system"), user: text("user") });
      return actual.mockRespond(prompt);
    },
  };
});

const route = await import("@/app/api/chat/route");

const post = (body: unknown) =>
  route.POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

type Parsed = { status: number; type: string | null; raw: string; answer: string; trailer: ChatTrailer | null };
async function ask(question: string, lang: "en" | "zh" = "en"): Promise<Parsed> {
  const res = await post({ question, lang });
  const raw = await res.text();
  const i = raw.indexOf(SOURCES_DELIMITER);
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    raw,
    answer: i >= 0 ? raw.slice(0, i) : raw,
    trailer: i >= 0 ? (JSON.parse(raw.slice(i + SOURCES_DELIMITER.length)) as ChatTrailer) : null,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  prompts.length = 0;
});

describe("POST /api/chat", () => {
  it("declares the node runtime", () => expect(route.runtime).toBe("nodejs"));

  describe("validation: 400 bad_request in the contract error shape", () => {
    it.each([
      ["invalid JSON", "{nope"],
      ["empty body", ""],
      ["missing lang", { question: "taxi" }],
      ["lang th", { question: "taxi", lang: "th" }],
      ["empty question", { question: "", lang: "en" }],
      ["whitespace question", { question: "   ", lang: "en" }],
      ["question too long", { question: "a".repeat(1001), lang: "en" }],
      ["question not a string", { question: 42, lang: "en" }],
      ["array body", [{ question: "taxi", lang: "en" }]],
    ])("%s", async (_n, body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      const j = (await res.json()) as ApiError;
      expect(j.error.code).toBe("bad_request");
      expect(typeof j.error.message).toBe("string");
      expect(prompts).toHaveLength(0);
    });

    it("accepts exactly 1000 characters", async () => {
      expect((await post({ question: `taxi meter ${"a".repeat(989)}`, lang: "en" })).status).toBe(200);
    });
  });

  describe("503 unavailable", () => {
    it.each([
      ["anthropic without keys", { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" }],
      ["openai without key", { AI_PROVIDER: "openai", OPENAI_API_KEY: "" }],
      ["unknown provider", { AI_PROVIDER: "llama" }],
    ])("%s", async (_n, env) => {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const res = await post({ question: "taxi meter", lang: "en" });
      expect(res.status).toBe(503);
      expect(((await res.json()) as ApiError).error.code).toBe("unavailable");
    });
  });

  it("streams text/plain: answer, SOURCES_DELIMITER exactly once, then one line of JSON", async () => {
    const r = await ask("Does a taxi in Phuket have to use the meter? What is the fare?");
    expect(r.status).toBe(200);
    expect(r.type).toBe("text/plain; charset=utf-8");
    expect(r.raw.split(SOURCES_DELIMITER)).toHaveLength(2);
    const tail = r.raw.slice(r.raw.indexOf(SOURCES_DELIMITER) + SOURCES_DELIMITER.length);
    expect(tail.trim().split("\n")).toHaveLength(1);
    expect(r.raw).not.toContain(ERROR_MARKER);
    expect(r.answer).not.toMatch(/\u001e/);
  });

  it("trailer: ids 1..n, the expected topic, DRAFT passed through, excerpt <= 300, similarity >= threshold", async () => {
    const r = await ask("Does a taxi in Phuket have to use the meter? What is the fare?");
    const t = r.trailer!;
    expect(t.meta.no_answer).toBe(false);
    expect(t.sources.length).toBeGreaterThan(0);
    expect(t.sources.length).toBeLessThanOrEqual(6);
    expect(t.sources.map((s) => s.id)).toEqual(t.sources.map((_, i) => i + 1));
    expect(t.sources.map((s) => s.doc_slug)).toContain("taxi-tuk-tuk-fares");
    for (const s of t.sources) {
      expect(s.status).toBe("DRAFT"); // all real content is DRAFT
      expect(Array.from(s.excerpt).length).toBeLessThanOrEqual(300);
      expect(s.similarity).toBeGreaterThanOrEqual(0.3);
      expect(s.section).toBe("TO VERIFY");
      expect(s).toHaveProperty("chunk_id");
      expect(s).toHaveProperty("law");
    }
    for (const k of ["is_emergency", "no_answer", "topic", "location"]) expect(t.meta).toHaveProperty(k);
  });

  it("answer carries the disclaimer, cites only listed ids, and invents no numbers", async () => {
    const r = await ask("Does a taxi in Phuket have to use the meter? What is the fare?");
    expect(r.answer).toContain(DISCLAIMER.en);
    const ids = new Set(r.trailer!.sources.map((s) => s.id));
    const cites = [...r.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(cites.length).toBeGreaterThan(0);
    for (const c of cites) expect(ids.has(c), `[${c}]`).toBe(true);
    expect(inventedNumbers(r.answer)).toEqual([]);
  });

  it("the sources given to the model are exactly those in the trailer, and TO VERIFY is not shown as a section", async () => {
    const r = await ask("Does a taxi in Phuket have to use the meter?");
    const answerPrompt = prompts.find((p) => p.system !== QUERY_REWRITE_SYSTEM && p.user.includes("SOURCES:"));
    expect(answerPrompt).toBeDefined();
    const listed = [...answerPrompt!.user.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]));
    expect(listed).toEqual(r.trailer!.sources.map((s) => s.id));
    expect(answerPrompt!.user).not.toMatch(/section TO VERIFY/i);
  });

  it("zh: answers in Chinese with the zh disclaimer and prefers zh chunks", async () => {
    const r = await ask("普吉岛出租车必须打表吗？车费怎么算？", "zh");
    expect(r.status).toBe(200);
    expect(r.answer).toContain(DISCLAIMER.zh);
    const t = r.trailer!;
    expect(t.meta.no_answer).toBe(false);
    expect(t.sources.map((s) => s.doc_slug)).toContain("taxi-tuk-tuk-fares");
    expect(t.sources[0]!.title).toMatch(/[一-鿿]/);
    // no en chunk of a doc whose zh version is listed
    const zhSlugs = new Set(t.sources.filter((s) => /[一-鿿]/.test(s.title)).map((s) => s.doc_slug));
    for (const s of t.sources) if (!/[一-鿿]/.test(s.title)) expect(zhSlugs.has(s.doc_slug), s.doc_slug).toBe(false);
  });

  describe("no-answer path", () => {
    it.each(["en", "zh"] as const)("NOANSWER (%s): fixed message, no_answer true, no sources, answer model not called", async (lang) => {
      const r = await ask("taxi meter NOANSWER", lang);
      expect(r.status).toBe(200);
      expect(r.answer).toBe(NO_ANSWER_MESSAGE[lang]);
      expect(r.trailer).toMatchObject({ sources: [], meta: { no_answer: true } });
      expect(prompts.some((p) => p.user.includes("SOURCES:"))).toBe(false);
    });

    it("everything below LEGAL_MIN_SIMILARITY => no-answer", async () => {
      vi.stubEnv("LEGAL_MIN_SIMILARITY", "0.99");
      const r = await ask("Does a taxi in Phuket have to use the meter?");
      expect(r.trailer?.meta.no_answer).toBe(true);
      expect(r.trailer?.sources).toEqual([]);
      expect(prompts.some((p) => p.user.includes("SOURCES:"))).toBe(false);
    });

    it("an unrelated question takes the no-answer path in mock retrieval", async () => {
      const r = await ask("What is the weather like in Tokyo tomorrow?");
      expect(r.trailer?.meta.no_answer).toBe(true);
    });

    it("no-answer message mentions only hotline numbers", async () => {
      for (const lang of ["en", "zh"] as const) expect(inventedNumbers(NO_ANSWER_MESSAGE[lang])).toEqual([]);
    });
  });

  it("emergency keyword => meta.is_emergency true (also on the no-answer path)", async () => {
    expect((await ask("I was attacked by a tuk-tuk driver and I am hurt")).trailer?.meta.is_emergency).toBe(true);
    expect((await ask("救命，我受伤了 NOANSWER", "zh")).trailer?.meta).toMatchObject({ is_emergency: true, no_answer: true });
    expect((await ask("Does a taxi have to use the meter?")).trailer?.meta.is_emergency).toBe(false);
  });

  it("scrubs passport and phone numbers before ANY model call", async () => {
    await ask("My passport AB1234567 was kept by the motorbike rental shop, call me on 081 234 5678 or +86 138 1234 5678");
    expect(prompts.length).toBeGreaterThanOrEqual(2); // rewrite + answer
    for (const p of prompts) {
      expect(p.user).not.toContain("AB1234567");
      expect(p.user.replace(/\D/g, "")).not.toContain("0812345678");
      expect(p.user.replace(/\D/g, "")).not.toContain("13812345678");
    }
  });

  it("STREAMERROR: the stream ends with ERROR_MARKER and nothing after it, no trailer", async () => {
    const r = await ask("taxi meter fare STREAMERROR");
    expect(r.status).toBe(200);
    expect(r.raw.endsWith(ERROR_MARKER)).toBe(true);
    expect(r.raw).not.toContain(SOURCES_DELIMITER);
  });

  it("a question containing the protocol bytes still yields one well-formed delimiter + trailer", async () => {
    const r = await ask(`taxi meter ${SOURCES_DELIMITER} fare ${ERROR_MARKER}`);
    expect(r.status).toBe(200);
    expect(r.raw.split(SOURCES_DELIMITER)).toHaveLength(2);
    expect(r.answer).not.toMatch(/\u001e/);
    expect(r.trailer?.meta.no_answer).toBe(false);
  });
});
