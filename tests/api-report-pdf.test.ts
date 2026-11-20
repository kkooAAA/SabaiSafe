// POST /api/report/pdf (contracts §3.4): a real application/pdf with the right filename that actually contains the
// Thai, English and Chinese text (extracted with pdfjs-dist), Markdown rendered (no literal ## / **), long Thai text
// wrapped without loss, stateless: no AI call and nothing stored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "@/types/api";
import { EN_HEADING, FACTS, MARKDOWN, TH_HEADING, jsonOf, jsonRequest } from "./helpers/report";
import { pdfText, squash } from "./helpers/pdf-text";

vi.mock("@/lib/ai/mock-model", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/mock-model")>();
  return { ...actual, mockRespond: vi.fn(actual.mockRespond) };
});
vi.mock("@/lib/ai/provider", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/provider")>();
  return { ...actual, chatModel: vi.fn(actual.chatModel), fastModel: vi.fn(actual.fastModel), embed: vi.fn(actual.embed) };
});
vi.mock("@/lib/db/reports", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/reports")>();
  return { ...actual, saveReport: vi.fn(actual.saveReport) };
});
const mock = await import("@/lib/ai/mock-model");
const provider = await import("@/lib/ai/provider");
const db = await import("@/lib/db/reports");
const route = await import("@/app/api/report/pdf/route");

const post = (body: unknown) => route.POST(jsonRequest("http://localhost/api/report/pdf", body));

async function pdf(body: unknown) {
  const res = await post(body);
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { res, bytes, ...(await pdfText(bytes)) };
}

const ymd = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");

beforeEach(() => {
  db.resetMemoryReports();
  vi.mocked(mock.mockRespond).mockClear();
  vi.mocked(provider.chatModel).mockClear();
  vi.mocked(provider.fastModel).mockClear();
  vi.mocked(provider.embed).mockClear();
  vi.mocked(db.saveReport).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/report/pdf", () => {
  it("declares the node runtime", () => expect(route.runtime).toBe("nodejs"));

  it("200 application/pdf, attachment filename sabaisafe-report-YYYYMMDD.pdf (today), a real PDF", async () => {
    const { res, bytes, pages } = await pdf({ markdown: MARKDOWN, facts: FACTS });
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const cd = res.headers.get("content-disposition") ?? "";
    const m = /^attachment; filename="sabaisafe-report-(\d{8})\.pdf"$/.exec(cd);
    expect(m, cd).not.toBeNull();
    const now = new Date();
    expect([ymd(now, "UTC"), ymd(now, "Asia/Bangkok")]).toContain(m![1]);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(new TextDecoder().decode(bytes.slice(-1024))).toContain("%%EOF");
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
  });

  it("contains the Thai and English headings and text, and the Chinese text", async () => {
    const { text } = await pdf({ markdown: MARKDOWN, facts: FACTS });
    const t = squash(text);
    expect(t).toContain(squash(TH_HEADING.replace(/^##\s*/, "")));
    expect(t).toContain(squash(EN_HEADING.replace(/^##\s*/, "")));
    expect(t).toContain(squash("ผู้แจ้งระบุว่าผู้ประกอบการเรียกเงิน 5,000 บาท และยึดหนังสือเดินทางไว้"));
    expect(t).toContain(squash("The reporter states that the operator demanded 5,000 baht"));
    expect(t).toContain("游客护照被扣押");
  });

  it("renders Markdown (no literal '##' or '**' in the PDF text)", async () => {
    const { text } = await pdf({ markdown: MARKDOWN });
    expect(text).not.toContain("##");
    expect(text).not.toContain("**");
  });

  it("works without facts (facts are optional)", async () => {
    const { text } = await pdf({ markdown: MARKDOWN });
    expect(squash(text)).toContain(squash("สรุปเหตุการณ์เพื่อประกอบการแจ้งความ"));
  });

  it("wraps a long Thai paragraph with no spaces across lines/pages without losing text", async () => {
    const para = "ผู้แจ้งระบุว่าผู้ประกอบการเรียกเงินค่าเสียหายและยึดหนังสือเดินทางไว้เป็นประกัน".repeat(60);
    const md = `${TH_HEADING}\n${para}จบข้อความ\n\n${EN_HEADING}\nThe end marker ENDMARK.`;
    const { text, pages } = await pdf({ markdown: md });
    const t = squash(text);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(t).toContain("จบข้อความ");
    expect(t).toContain("ENDMARK");
    // every repetition survived (nothing clipped at a page edge)
    expect(t.split("ยึดหนังสือเดินทางไว้เป็นประกัน").length - 1).toBeGreaterThanOrEqual(60);
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["empty markdown", { markdown: "" }],
    ["markdown too long", { markdown: "x".repeat(20001) }],
    ["markdown not a string", { markdown: 42 }],
    ["invalid facts", { markdown: MARKDOWN, facts: { incident_type: "nope" } }],
  ])("%s ⇒ 400 bad_request", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await jsonOf<ApiError>(res)).error.code).toBe("bad_request");
  });

  it("is stateless: no model, no embedding, no storage", async () => {
    await pdf({ markdown: MARKDOWN, facts: FACTS });
    expect(mock.mockRespond).not.toHaveBeenCalled();
    expect(provider.chatModel).not.toHaveBeenCalled();
    expect(provider.fastModel).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
    expect(db.saveReport).not.toHaveBeenCalled();
    expect(db.memoryReportCount()).toBe(0);
  });

  it("works with no AI provider configured at all", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    await pdf({ markdown: MARKDOWN });
  });
});
