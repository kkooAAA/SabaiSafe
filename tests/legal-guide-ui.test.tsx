// @vitest-environment jsdom
// components/legal/LegalGuide.tsx rendered with a stubbed /api/chat stream (P2-4, contracts §3.1).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { Markdown } from "@/components/shared/Markdown";
import { DISCLAIMER } from "@/lib/ai/prompts";
import { NO_ANSWER_MESSAGE } from "@/lib/ai/constants";
import { ERROR_MARKER, SOURCES_DELIMITER } from "@/types/protocol";

// next/dynamic(ssr:false) would render nothing synchronously; use the real Markdown component directly.
vi.mock("next/dynamic", () => ({ default: () => Markdown }));

const { LegalGuide } = await import("@/components/legal/LegalGuide");

// jsdom has no scrollIntoView.
Element.prototype.scrollIntoView = () => {};

const src = (id: number, status: "DRAFT" | "VERIFIED", over: Record<string, unknown> = {}) => ({
  id,
  chunk_id: id,
  doc_slug: "taxi-tuk-tuk-fares",
  title: `Source ${id}`,
  law: "Land Transport Act B.E. 2522",
  law_th: null,
  section: "TO VERIFY",
  location: "Phuket",
  source_url: null,
  status,
  similarity: 0.7,
  excerpt: "Excerpt",
  ...over,
});
const body = (answer: string, sources: unknown[], meta: Record<string, unknown> = {}) =>
  answer + SOURCES_DELIMITER + JSON.stringify({ sources, meta: { is_emergency: false, no_answer: false, topic: "transport", location: null, ...meta } }) + "\n";

function stream(chunks: string[], status = 200) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

function setup(locale: "en" | "zh", response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
      <LegalGuide />
    </NextIntlClientProvider>,
  );
  return fetchMock;
}

async function ask(q: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: q } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LegalGuide", () => {
  it("posts {question, lang}, renders the answer, linked citations, draft badge, and the disclaimer once", async () => {
    const answer = `Taxis must use the meter [1]. See also [2] and [7].\n\n${DISCLAIMER.en}`;
    // split the delimiter across chunks
    const full = body(answer, [src(1, "DRAFT"), src(2, "VERIFIED")]);
    const fetchMock = setup("en", stream([full.slice(0, 30), full.slice(30, answer.length + 3), full.slice(answer.length + 3)]));
    await ask("Taxi meter?");
    await waitFor(() => expect(screen.getByText("Source 1")).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toEqual({ question: "Taxi meter?", lang: "en" });

    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("#src-"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#src-1", "#src-2"]);
    expect(document.body.textContent).toContain("[7]"); // unknown id stays plain text
    expect(document.body.textContent).not.toMatch(/\u001e/);

    const cards = document.querySelectorAll("li[id^=src-]");
    expect([...cards].map((c) => c.getAttribute("data-status"))).toEqual(["DRAFT", "VERIFIED"]);
    // Section "TO VERIFY" is never displayed as a section.
    expect(document.body.textContent).not.toContain("TO VERIFY");

    const occurrences = document.body.textContent!.split(DISCLAIMER.en).length - 1;
    expect(occurrences).toBe(1);
    expect(screen.getByTestId("legal-disclaimer")).toHaveTextContent(DISCLAIMER.en);
  });

  it("no-answer path (zh): shows the hotlines, no sources, disclaimer still shown", async () => {
    setup("zh", stream([body(NO_ANSWER_MESSAGE.zh, [], { no_answer: true })]));
    await ask("普吉岛哪家按摩店最好？");
    const na = await screen.findByTestId("no-answer");
    for (const n of ["1155", "191", "1669"]) expect(within(na).getAllByText(new RegExp(n)).length).toBeGreaterThan(0);
    expect(document.querySelectorAll("li[id^=src-]")).toHaveLength(0);
    expect(screen.getByTestId("legal-disclaimer")).toHaveTextContent(DISCLAIMER.zh);
  });

  it("server is_emergency shows the emergency banner", async () => {
    setup("en", stream([body(`Go somewhere safe [1].\n\n${DISCLAIMER.en}`, [src(1, "DRAFT")], { is_emergency: true })]));
    await ask("Is the tuk-tuk allowed to charge this?");
    expect(await screen.findByTestId("emergency-banner")).toBeInTheDocument();
  });

  it("urgent question shows the banner immediately, even before the answer", async () => {
    setup("en", new Response(new ReadableStream({ start() {} }), { status: 200 })); // never ends
    await ask("I was attacked by a driver");
    expect(await screen.findByTestId("emergency-banner")).toBeInTheDocument();
  });

  it("ERROR_MARKER mid-stream: keeps the partial answer, shows an error, no marker bytes", async () => {
    setup("en", stream(["Partial answer", ERROR_MARKER]));
    await ask("Taxi meter?");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Partial answer");
    expect(document.body.textContent).not.toMatch(/\u001e/);
  });

  it("bad trailer JSON: answer + disclaimer, no sources", async () => {
    setup("en", stream([`An answer [1].${SOURCES_DELIMITER}{not json\n`]));
    await ask("Taxi meter?");
    await waitFor(() => expect(document.body.textContent).toContain("An answer"));
    expect(document.querySelectorAll("li[id^=src-]")).toHaveLength(0);
    expect(screen.getByTestId("legal-disclaimer")).toBeInTheDocument();
  });

  it("503 / 429 show an error, no crash", async () => {
    setup("en", new Response(JSON.stringify({ error: { code: "unavailable", message: "x" } }), { status: 503 }));
    await ask("Taxi meter?");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("empty question is rejected client-side without a request", async () => {
    const fetchMock = setup("en", stream([""]));
    await ask("   ");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
