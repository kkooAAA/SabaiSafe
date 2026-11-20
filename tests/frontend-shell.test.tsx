// frontend P1-4/6/7: text-stream reader, nav, price sort, StatusBadge; ai unit labels never leak raw keys.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { postTextStream, splitErrorMarker } from "@/components/shared/text-stream";
import { isActive, NAV_ITEMS } from "@/components/shell/nav-items";
import { sortPrices } from "@/components/price/picker";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmergencyStrip } from "@/components/shell/EmergencyStrip";
import { UNIT_LABEL, toPromptRefs } from "@/lib/ai/price";
import { fairPriceUser } from "@/lib/ai/prompts";
import { ERROR_MARKER, PRICE_UNITS, type PriceRef } from "@/types/api";

const price = (over: Partial<PriceRef>): PriceRef => ({
  id: Math.random().toString(36), item_key: "k", item_name_en: "K", item_name_zh: "钾", category: "transport", area: "Patong",
  min_thb: 1, max_thb: 2, unit: "per_trip", is_fixed_by_law: false, source: "SAMPLE DATA", source_url: null,
  collected_at: "2026-11-01", notes: null, notes_zh: null, is_sample: true, ...over,
});

describe("splitErrorMarker", () => {
  it("returns text before the marker and error=true", () => {
    expect(splitErrorMarker(`partial${ERROR_MARKER}`)).toEqual({ text: "partial", error: true });
  });
  it("hides every partial marker prefix while streaming, shows it when done", () => {
    for (let n = 1; n < ERROR_MARKER.length; n++) {
      const buf = `abc${ERROR_MARKER.slice(0, n)}`;
      expect(splitErrorMarker(buf).text, `n=${n}`).toBe("abc");
      expect(splitErrorMarker(buf, true)).toEqual({ text: buf, error: false });
    }
  });
  it("passes ordinary text through", () => expect(splitErrorMarker("hello [1]")).toEqual({ text: "hello [1]", error: false }));
});

function streamResponse(chunks: string[], init: ResponseInit = {}) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" }, ...init },
  );
}

describe("postTextStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams text and reports the final text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(["Verdict: ", "Within", " normal range"])));
    const seen: string[] = [];
    const r = await postTextStream("/api/chat/price", { item: "x" }, (t) => seen.push(t));
    expect(r).toEqual({ ok: true, text: "Verdict: Within normal range", error: false });
    expect(seen.at(-1)).toBe("Verdict: Within normal range");
  });

  it("detects ERROR_MARKER split across chunks and never shows its bytes", async () => {
    const half = Math.floor(ERROR_MARKER.length / 2);
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(["partial", ERROR_MARKER.slice(0, half), ERROR_MARKER.slice(half)])));
    const seen: string[] = [];
    const r = await postTextStream("/x", {}, (t) => seen.push(t));
    expect(r).toEqual({ ok: true, text: "partial", error: true });
    for (const s of seen) expect(s).not.toContain("\u001e");
  });

  it("keeps multi-byte characters split across chunks intact", async () => {
    const bytes = new TextEncoder().encode("普吉岛");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 4)); c.enqueue(bytes.slice(4)); c.close(); } }))));
    const r = await postTextStream("/x", {}, () => {});
    expect(r.ok && r.text).toBe("普吉岛");
  });

  it("returns the contract error code on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "rate_limited", message: "m" } }, { status: 429 })));
    expect(await postTextStream("/x", {}, () => {})).toEqual({ ok: false, status: 429, code: "rate_limited" });
  });

  it("falls back to internal on a non-JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 502 })));
    expect(await postTextStream("/x", {}, () => {})).toEqual({ ok: false, status: 502, code: "internal" });
  });

  it("sends JSON", async () => {
    const f = vi.fn(async (...args: [string, RequestInit?]) => (void args, streamResponse(["ok"])));
    vi.stubGlobal("fetch", f);
    await postTextStream("/api/chat/price", { a: 1 }, () => {});
    const init = f.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.body).toBe('{"a":1}');
  });
});

describe("nav", () => {
  it("has the 4 features plus home", () => expect(NAV_ITEMS.map((n) => n.key)).toEqual(["home", "legal", "report", "price", "help"]));
  it.each([
    ["/", "/", true],
    ["/legal", "/", false],
    ["/legal", "/legal", true],
    ["/legal/x", "/legal", true],
    ["/legalese", "/legal", false],
    ["/price", "/help", false],
  ])("isActive(%j, %j) = %s", (p, h, want) => expect(isActive(p, h)).toBe(want));
  it("every nav key has en and zh labels", () => {
    const flat = (o: object): string => JSON.stringify(o);
    for (const n of NAV_ITEMS) {
      expect(flat(en)).toContain(`"${n.key}"`);
      expect(flat(zh)).toContain(`"${n.key}"`);
    }
  });
});

describe("sortPrices", () => {
  it("orders by category, label (per locale), island-wide first, then area; does not mutate", () => {
    const rows = [
      price({ category: "food", item_name_en: "Water", item_name_zh: "水", area: "Patong" }),
      price({ item_name_en: "Tuk-tuk", item_name_zh: "嘟嘟车", area: "Patong" }),
      price({ item_name_en: "Tuk-tuk", item_name_zh: "嘟嘟车", area: "Phuket" }),
      price({ item_name_en: "Airport taxi", item_name_zh: "机场出租车", area: "Phuket Airport" }),
    ];
    const ids = rows.map((r) => r.id);
    const s = sortPrices(rows, "en").map((r) => `${r.item_name_en}@${r.area}`);
    expect(s).toEqual(["Airport taxi@Phuket Airport", "Tuk-tuk@Phuket", "Tuk-tuk@Patong", "Water@Patong"]);
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(sortPrices(rows, "zh").at(-1)?.category).toBe("food");
  });
});

describe("StatusBadge / EmergencyStrip render", () => {
  const wrap = (locale: "en" | "zh", el: React.ReactElement) =>
    renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>{el}</NextIntlClientProvider>);

  it.each(["en", "zh"] as const)("renders every badge kind with localized text (%s)", (locale) => {
    for (const kind of ["sample", "verified", "unverified", "sponsored"] as const) {
      const html = wrap(locale, <StatusBadge kind={kind} />);
      expect(html).toContain(`data-kind="${kind}"`);
      const text = html.replace(/<[^>]+>/g, "");
      expect(text.trim().length, kind).toBeGreaterThan(0);
      expect(text, kind).not.toContain("common.");
      if (locale === "zh") expect(text, kind).toMatch(/[一-鿿]/);
    }
  });

  it.each(["en", "zh"] as const)("emergency strip links 1155, 191, 1669 (%s)", (locale) => {
    const html = wrap(locale, <EmergencyStrip />);
    for (const n of ["1155", "191", "1669"]) expect(html).toContain(`href="tel:${n}"`);
    expect(html).not.toMatch(/emergency\.short\./);
  });
});

describe("price prompt never shows raw unit keys", () => {
  it("UNIT_LABEL covers every PRICE_UNITS key in en and zh", () => {
    for (const u of PRICE_UNITS) {
      expect(UNIT_LABEL[u]?.en, u).toMatch(/^per /);
      expect(UNIT_LABEL[u]?.zh, u).toMatch(/[一-鿿]/);
    }
  });

  it.each(["en", "zh"] as const)("fairPriceUser has no per_* key (%s)", (lang) => {
    const rows = PRICE_UNITS.map((unit) => price({ unit }));
    const text = fairPriceUser("x", 100, toPromptRefs(rows, lang));
    expect(text).not.toMatch(/per_[a-z0-9]+/);
  });
});
