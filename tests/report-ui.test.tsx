// @vitest-environment jsdom
// Report Assistant UI (P3-4, contracts §3.2–3.5a, §6): pure helpers in components/report/report-state.ts, and the
// whole flow rendered with a stubbed fetch: notice → chat → [READY] → summary → PDF → unticked consent → save.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { Markdown } from "@/components/shared/Markdown";
import {
  CONSENT_VERSION,
  ERROR_MARKER,
  MAX_CONVERSATION_CHARS,
  MAX_CONVERSATION_MESSAGES,
  MAX_MESSAGE_CHARS,
  READY_TOKEN,
} from "@/types/protocol";
import {
  SAVED_REPORT_KEY,
  appendUserMessage,
  buildChatRequest,
  buildGenerateRequest,
  buildSaveRequest,
  checkNextMessage,
  commitReply,
  errorKeyFor,
  loadSavedReport,
  parseInterviewReply,
  saveReplacing,
  pdfFilename,
  splitSummary,
  storeSavedReport,
  type Msg,
} from "@/components/report/report-state";
import { FACTS, MARKDOWN, TH_HEADING, EN_HEADING } from "./helpers/report";

vi.mock("next/dynamic", () => ({ default: () => Markdown }));
const { ReportAssistant } = await import("@/components/report/ReportAssistant");
Element.prototype.scrollIntoView = () => {};
// jsdom: no rAF in some versions, no object URLs.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame;

const u = (content: string): Msg => ({ role: "user", content });
const a = (content: string): Msg => ({ role: "assistant", content });

// ------------------------------------------------------------------ pure helpers
describe("parseInterviewReply", () => {
  it("strips the final \\n[READY] and reports ready only when done", () => {
    expect(parseInterviewReply(`Thanks.\n${READY_TOKEN}`, true)).toEqual({ text: "Thanks.", ready: true });
    expect(parseInterviewReply(`Thanks.\n${READY_TOKEN}`, false).ready).toBe(false);
    expect(parseInterviewReply(`Thanks.\n${READY_TOKEN}`, false).text).toBe("Thanks.");
  });
  it.each(["\n", "\n[", "\n[RE", "\n[READY"])("hides the partial suffix %j while streaming", (tail) => {
    expect(parseInterviewReply(`Thanks.${tail}`, false).text).toBe("Thanks.");
  });
  it("a token in the middle is never ready and never shown", () => {
    const r = parseInterviewReply(`Done ${READY_TOKEN} more text`, true);
    expect(r.ready).toBe(false);
    expect(r.text).not.toContain(READY_TOKEN);
    expect(parseInterviewReply("x [REA[READY]DY] y", true).text).not.toContain(READY_TOKEN);
  });
  it("plain text is untouched", () => expect(parseInterviewReply("Mock question 2?", true)).toEqual({ text: "Mock question 2?", ready: false }));
});

describe("conversation building (§3.2: first/last user, limits from types/protocol)", () => {
  it("the local greeting is never part of the conversation; requests start with user", () => {
    const msgs = appendUserMessage([], "my bag was stolen");
    expect(buildChatRequest(msgs, "en")).toEqual({ messages: [u("my bag was stolen")], lang: "en" });
    expect(buildChatRequest([a("hi"), u("x")], "en")).toBeNull();
    expect(buildChatRequest([u("x"), a("y")], "en")).toBeNull();
    expect(buildChatRequest([], "en")).toBeNull();
  });
  it("after a failed reply the next text merges into the last user message (keeps alternation)", () => {
    expect(appendUserMessage([u("a")], "b")).toEqual([u("a\n\nb")]);
  });
  it("commitReply drops empty replies and caps long ones", () => {
    expect(commitReply([u("a")], "  ")).toEqual([u("a")]);
    expect(commitReply([u("a")], "x".repeat(MAX_MESSAGE_CHARS + 50))[1]!.content).toHaveLength(MAX_MESSAGE_CHARS);
  });
  it("checkNextMessage enforces the per-message, count and total limits with room for the reply", () => {
    expect(checkNextMessage([], " ")).toBe("empty");
    expect(checkNextMessage([], "x".repeat(MAX_MESSAGE_CHARS + 1))).toBe("message_too_long");
    // 58 messages ending with assistant: +1 user +1 reply = 60 is still allowed; 60 is not.
    const conv = (n: number): Msg[] => Array.from({ length: n }, (_, i) => (i % 2 ? a("a") : u("u")));
    expect(checkNextMessage(conv(MAX_CONVERSATION_MESSAGES - 2), "next")).toBeNull();
    expect(checkNextMessage(conv(MAX_CONVERSATION_MESSAGES), "next")).toBe("too_many");
    const big = Array.from({ length: 5 }, (_, i) => (i % 2 ? a("a".repeat(3900)) : u("u".repeat(3900))));
    expect(checkNextMessage([...big, a("ok")], "x".repeat(100))).toBe("too_long");
    expect(MAX_CONVERSATION_CHARS).toBe(20_000);
  });
  it("buildGenerateRequest sends the whole conversation (may end with the read-back)", () => {
    const msgs = [u("x"), a(`ok`)];
    expect(buildGenerateRequest(msgs)).toEqual({ messages: msgs });
  });
});

describe("save / storage helpers", () => {
  it("buildSaveRequest needs consent === true and sends the literal true + CONSENT_VERSION", () => {
    const s = { facts: FACTS, markdown: MARKDOWN };
    expect(buildSaveRequest(s, "en", false)).toBeNull();
    expect(buildSaveRequest(s, "en", "true" as unknown as boolean)).toBeNull();
    expect(buildSaveRequest(s, "zh", true)).toEqual({ ...s, lang: "zh", consent: true, consent_version: CONSENT_VERSION });
  });
  it("localStorage keeps only id, token and expiry; expired or malformed records are dropped", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const rec = { id: "id-1", delete_token: "tok", expires_at: new Date(Date.now() + 86400000).toISOString() };
    expect(storeSavedReport({ ...rec, facts: FACTS, markdown: MARKDOWN } as typeof rec, store)).toBe(true);
    expect(Object.keys(JSON.parse(mem.get(SAVED_REPORT_KEY)!)).sort()).toEqual(["delete_token", "expires_at", "id"]);
    expect(loadSavedReport(store)).toEqual(rec);
    expect(loadSavedReport(store, Date.parse(rec.expires_at) + 1)).toBeNull();
    expect(mem.has(SAVED_REPORT_KEY)).toBe(false);
    mem.set(SAVED_REPORT_KEY, "{bad");
    expect(loadSavedReport(store)).toBeNull();
  });
  it("errorKeyFor maps the contract codes", () => {
    expect(errorKeyFor("save", 400, "consent_required")).toBe("consent_required");
    expect(errorKeyFor("save", 400, "consent_outdated")).toBe("consent_outdated");
    expect(errorKeyFor("save", 503, "unavailable")).toBe("save_unavailable");
    expect(errorKeyFor("open", 404, "not_found")).toBe("not_found");
    expect(errorKeyFor("chat", 429, "rate_limited")).toBe("rate_limited");
    expect(errorKeyFor("chat", 0)).toBe("network");
  });
  it("every errorKeyFor result exists in both message files", () => {
    const keys = new Set<string>();
    for (const act of ["chat", "generate", "pdf", "save", "open", "delete"] as const)
      for (const st of [0, 400, 404, 429, 500, 503])
        for (const c of [null, "consent_required", "consent_outdated", "not_found", "unavailable", "rate_limited"])
          keys.add(errorKeyFor(act, st, c));
    keys.add("incomplete");
    keys.add("too_long_or_invalid");
    const errs = (m: typeof en) => (m as unknown as { report: { errors: Record<string, string> } }).report.errors;
    for (const k of keys) {
      expect(errs(en)[k], `en report.errors.${k}`).toBeTruthy();
      expect(errs(zh as typeof en)[k], `zh report.errors.${k}`).toBeTruthy();
    }
  });
  it("pdfFilename keeps the server name, sanitises, and falls back", () => {
    expect(pdfFilename('attachment; filename="sabaisafe-report-20261120.pdf"')).toBe("sabaisafe-report-20261120.pdf");
    expect(pdfFilename('attachment; filename="../../evil.sh"', new Date("2026-11-20T00:00:00Z"))).toBe("sabaisafe-report-20261120.pdf");
    expect(pdfFilename(null, new Date("2026-11-20T00:00:00Z"))).toBe("sabaisafe-report-20261120.pdf");
  });
  it("splitSummary splits on the two §3.3 headings", () => {
    const s = splitSummary(MARKDOWN)!;
    expect(s.th.startsWith(TH_HEADING)).toBe(true);
    expect(s.en.startsWith(EN_HEADING)).toBe(true);
    expect(s.th).not.toContain(EN_HEADING);
    expect(splitSummary("no headings")).toBeNull();
  });
});

// ------------------------------------------------------------------ rendered flow
function textStream(chunks: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
type Call = { url: string; init: RequestInit; body: unknown };

function setup(locale: "en" | "zh", replies: Record<string, (body: unknown, n: number) => Response>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ url, init, body });
      const key = Object.keys(replies).find((k) => url === k || url.startsWith(k + "/"))!;
      counts[key] = (counts[key] ?? 0) + 1;
      return replies[key]!(body, counts[key]!);
    }),
  );
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
      <ReportAssistant />
    </NextIntlClientProvider>,
  );
  return calls;
}

async function send(text: string) {
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.submit(box.closest("form")!);
}

const CHAT_REPLIES = (body: unknown, n: number) =>
  n === 1 ? textStream(["Mock que", "stion 1?"]) : textStream(["Thank you for ", "confirming.", "\n[RE", "ADY]"]);

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReportAssistant flow", () => {
  it("privacy notice first, then greeting; nothing is sent before the user types", async () => {
    const calls = setup("en", { "/api/report/chat": CHAT_REPLIES });
    expect(screen.getByTestId("report-notice")).toHaveTextContent(en.report.notice.aiProvider);
    expect(screen.getByTestId("report-notice")).toHaveTextContent(en.report.notice.noPassport);
    fireEvent.click(screen.getByRole("button", { name: en.report.notice.start }));
    expect(screen.getByTestId("report-chat")).toHaveTextContent(en.report.chat.greeting);
    expect(calls).toHaveLength(0);
  });

  it("[READY] is never displayed; Create summary is enabled only after it; requests start and end with user", async () => {
    const calls = setup("en", { "/api/report/chat": CHAT_REPLIES });
    fireEvent.click(screen.getByRole("button", { name: en.report.notice.start }));
    const create = () => screen.getByTestId("report-create-summary");
    await send("My bag was stolen at Patong");
    await screen.findByText("Mock question 1?");
    expect(create()).toBeDisabled();
    await send("yes");
    await screen.findByText("Thank you for confirming.");
    await waitFor(() => expect(create()).toBeEnabled());
    expect(document.body.textContent).not.toContain(READY_TOKEN);
    expect(document.body.textContent).not.toContain("[RE");

    const chats = calls.filter((c) => c.url === "/api/report/chat").map((c) => c.body as { messages: Msg[]; lang: string });
    expect(chats).toHaveLength(2);
    for (const b of chats) {
      expect(b.lang).toBe("en");
      expect(b.messages[0]!.role).toBe("user");
      expect(b.messages.at(-1)!.role).toBe("user");
      expect(JSON.stringify(b)).not.toContain(en.report.chat.greeting);
    }
    expect(chats[1]!.messages).toEqual([u("My bag was stolen at Patong"), a("Mock question 1?"), u("yes")]);
  });

  it("ERROR_MARKER mid-stream: error shown, partial reply not committed, retry resends the same conversation", async () => {
    let n = 0;
    const calls = setup("en", {
      "/api/report/chat": () => (++n === 1 ? textStream(["Partial ans", `wer${ERROR_MARKER}`]) : textStream(["Mock question 1?"])),
    });
    fireEvent.click(screen.getByRole("button", { name: en.report.notice.start }));
    await send("bag stolen");
    await screen.findByTestId("report-chat-error");
    expect(document.body.textContent).not.toContain("\u001e");
    expect(screen.getByTestId("report-create-summary")).toBeDisabled();
    fireEvent.click(screen.getByTestId("report-retry"));
    await screen.findByText("Mock question 1?");
    const bodies = calls.map((c) => c.body as { messages: Msg[] });
    expect(bodies[1]!.messages).toEqual([u("bag stolen")]);
  });

  it("summary → PDF → consent starts unticked, Save disabled until ticked, saves literal consent, stores only id+token", async () => {
    const saveResp = { id: "6f1c0a8e-0d4b-4a59-9b8e-3a1f2c3d4e5f", delete_token: "t".repeat(43), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() };
    const calls = setup("en", {
      "/api/report/chat": CHAT_REPLIES,
      "/api/report/generate": () => Response.json({ facts: FACTS, markdown: MARKDOWN }),
      "/api/report/pdf": () =>
        new Response(new Uint8Array([37, 80, 68, 70, 45]), {
          headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="sabaisafe-report-20261120.pdf"' },
        }),
      "/api/report/save": () => Response.json(saveResp, { status: 201 }),
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: en.report.notice.start }));
    await send("bag stolen");
    await screen.findByText("Mock question 1?");
    await send("yes");
    await waitFor(() => expect(screen.getByTestId("report-create-summary")).toBeEnabled());
    fireEvent.click(screen.getByTestId("report-create-summary"));

    const summary = await screen.findByTestId("report-summary");
    expect(within(summary).getByTestId("report-th")).toHaveTextContent("ผู้แจ้งระบุว่า");
    expect(within(summary).getByTestId("report-en")).toHaveTextContent("The reporter states");
    expect(screen.getByTestId("report-not-police")).toHaveTextContent("1155");
    const gen = calls.find((c) => c.url === "/api/report/generate")!.body as { messages: Msg[] };
    expect(gen.messages[0]!.role).toBe("user");

    fireEvent.click(screen.getByTestId("report-download-pdf"));
    await screen.findByTestId("report-pdf-done");
    expect((calls.find((c) => c.url === "/api/report/pdf")!.body as { markdown: string }).markdown).toBe(MARKDOWN);

    const box = screen.getByTestId("report-consent") as HTMLInputElement;
    const saveBtn = screen.getByTestId("report-save-button");
    expect(box.checked).toBe(false);
    expect(saveBtn).toBeDisabled();
    expect(calls.some((c) => c.url === "/api/report/save")).toBe(false);
    fireEvent.click(box);
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);
    await screen.findByTestId("report-saved");

    const sent = calls.find((c) => c.url === "/api/report/save")!.body as Record<string, unknown>;
    expect(sent.consent).toBe(true);
    expect(sent.consent_version).toBe(CONSENT_VERSION);
    expect(sent.lang).toBe("en");
    const stored = JSON.parse(localStorage.getItem(SAVED_REPORT_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["delete_token", "expires_at", "id"]);
  });

  it("zh: Chinese greeting and lang zh in the request", async () => {
    const calls = setup("zh", { "/api/report/chat": () => textStream(["模拟问题 1？"]) });
    fireEvent.click(screen.getByRole("button", { name: zh.report.notice.start }));
    expect(screen.getByTestId("report-chat")).toHaveTextContent(zh.report.chat.greeting);
    await send("我的包被偷了");
    await screen.findByText("模拟问题 1？");
    expect((calls[0]!.body as { lang: string }).lang).toBe("zh");
  });

  it("a saved record on this device: Delete sends the token header, then the record is cleared", async () => {
    const rec = { id: "6f1c0a8e-0d4b-4a59-9b8e-3a1f2c3d4e5f", delete_token: "t".repeat(43), expires_at: new Date(Date.now() + 86400000).toISOString() };
    localStorage.setItem(SAVED_REPORT_KEY, JSON.stringify(rec));
    const calls = setup("en", { "/api/report": () => new Response(null, { status: 204 }) });
    await screen.findByTestId("report-saved");
    fireEvent.click(screen.getByTestId("report-delete-saved"));
    fireEvent.click(screen.getByTestId("report-delete-saved-yes"));
    await screen.findByTestId("report-deleted");
    const del = calls.find((c) => c.init.method === "DELETE")!;
    expect(del.url).toBe(`/api/report/${rec.id}`);
    expect((del.init.headers as Record<string, string>)["x-delete-token"]).toBe(rec.delete_token);
    expect(localStorage.getItem(SAVED_REPORT_KEY)).toBeNull();
  });
});

// ------------------------------------------------------------------ second save never orphans the first (PDPA)
describe("saveReplacing", () => {
  const prev = { id: "old", delete_token: "old-tok", expires_at: new Date(Date.now() + 86400000).toISOString() };
  const next = { id: "new", delete_token: "new-tok", expires_at: new Date(Date.now() + 86400000).toISOString() };
  const body = buildSaveRequest({ facts: FACTS, markdown: MARKDOWN }, "en", true)!;
  function deps(del: { ok: true; data: null } | { ok: false; status: number; code: string }, save: { ok: true; data: typeof next } | { ok: false; status: number; code: string }) {
    const order: string[] = [];
    return {
      order,
      d: {
        deleteSaved: vi.fn(async (r: typeof prev) => (order.push(`delete:${r.id}`), del)),
        saveSummary: vi.fn(async () => (order.push("save"), save)),
        store: vi.fn(() => (order.push("store"), true)),
        clear: vi.fn(() => void order.push("clear")),
      },
    };
  }

  it("with an earlier record: deletes it FIRST, then saves and stores the new one", async () => {
    const { d, order } = deps({ ok: true, data: null }, { ok: true, data: next });
    const r = await saveReplacing(prev, body, d);
    expect(r).toEqual({ ok: true, saved: next, remembered: true, replaced: true });
    expect(order).toEqual(["delete:old", "clear", "save", "store"]);
  });
  it("an earlier record already gone (404) is fine", async () => {
    const { d } = deps({ ok: false, status: 404, code: "not_found" }, { ok: true, data: next });
    expect((await saveReplacing(prev, body, d)).ok).toBe(true);
  });
  it("if deleting the earlier one fails, nothing is saved and its token is kept", async () => {
    const { d } = deps({ ok: false, status: 503, code: "unavailable" }, { ok: true, data: next });
    const r = await saveReplacing(prev, body, d);
    expect(r).toMatchObject({ ok: false, stage: "delete_old", previousGone: false });
    expect(d.saveSummary).not.toHaveBeenCalled();
    expect(d.clear).not.toHaveBeenCalled();
  });
  it("no earlier record: just saves", async () => {
    const { d, order } = deps({ ok: true, data: null }, { ok: true, data: next });
    expect(await saveReplacing(null, body, d)).toMatchObject({ ok: true, replaced: false });
    expect(order).toEqual(["save", "store"]);
  });
  it("replace strings exist in en and zh", () => {
    const save = (m: unknown) => (m as { report: { save: Record<string, string>; errors: Record<string, string> } }).report;
    for (const m of [en, zh]) {
      expect(save(m).save.replaces).toBeTruthy();
      expect(save(m).errors.replace_failed).toBeTruthy();
    }
  });
});
