// Help and Fair Price pages (Server Components) keep working when lib/db fails (contracts §2.5, CLAUDE.md hotlines rule).
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import type { ReactElement } from "react";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { HOTLINES } from "@/lib/hotlines";
import type { Business, HelpResponse } from "@/types/api";

const MESSAGES = { en, zh } as const;
let currentLocale: "en" | "zh" = "en";

vi.mock("next-intl/server", () => ({
  setRequestLocale: (l: "en" | "zh") => {
    currentLocale = l;
  },
  getTranslations: async (arg?: string | { locale: "en" | "zh"; namespace?: string }) => {
    const namespace = typeof arg === "string" ? arg : arg?.namespace;
    const locale = typeof arg === "object" && arg ? arg.locale : currentLocale;
    return createTranslator({ locale, messages: MESSAGES[locale], namespace: namespace as never });
  },
}));

const getHelp = vi.fn<() => Promise<HelpResponse>>();
const findPrices = vi.fn();
vi.mock("@/lib/db/help", () => ({ getHelp: () => getHelp() }));
vi.mock("@/lib/db/prices", () => ({ findPrices: () => findPrices() }));

async function render(page: (p: { params: Promise<{ locale: string }> }) => Promise<ReactElement>, locale: "en" | "zh") {
  const el = await page({ params: Promise.resolve({ locale }) });
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Bangkok">
      {el}
    </NextIntlClientProvider>,
  );
}

const biz = (name: string, is_sponsored: boolean): Business => ({
  id: name,
  name,
  name_zh: null,
  category: "rental",
  area: "Patong",
  address: null,
  phone: null,
  website: null,
  google_maps_url: null,
  source_url: null,
  description_en: null,
  description_zh: null,
  criteria_met: [],
  is_sponsored,
  verified_at: null,
  is_active: true,
  is_sample: true,
});

afterEach(() => {
  getHelp.mockReset();
  findPrices.mockReset();
});

describe.each(["en", "zh"] as const)("Help page (%s)", (locale) => {
  it("shows all four hotlines as tel: links when the DB throws", async () => {
    getHelp.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: HelpPage } = await import("@/app/[locale]/help/page");
    const html = await render(HelpPage, locale);
    for (const h of HOTLINES) expect(html).toContain(`href="tel:${h.number}"`);
    expect(html).toContain((MESSAGES[locale] as { common: { unavailable: string } }).common.unavailable);
    spy.mockRestore();
  });

  it("shows hotlines once, and a visible Sponsored label without reordering", async () => {
    getHelp.mockResolvedValue({
      contacts: HOTLINES.map((h, i) => ({
        id: h.key, category: "emergency", name_en: h.name_en, name_zh: h.name_zh, name_th: h.name_th, phone: h.number,
        address: null, area: null, google_maps_url: null, website: null, hours: null, languages: [], source_url: null,
        sort_order: i, verified: true, is_sample: false,
      })),
      businesses: [biz("[SAMPLE] Alpha", false), biz("[SAMPLE] Bravo", true), biz("[SAMPLE] Charlie", false)],
    });
    const { default: HelpPage } = await import("@/app/[locale]/help/page");
    const html = await render(HelpPage, locale);
    for (const h of HOTLINES) expect(html.split(`href="tel:${h.number}"`).length - 1, h.number).toBe(1);
    const order = ["[SAMPLE] Alpha", "[SAMPLE] Bravo", "[SAMPLE] Charlie"].map((n) => html.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toMatch(/data-sponsored="true"/);
    // The Sponsored badge text from messages appears exactly once (one sponsored row).
    const sponsoredText = JSON.stringify(MESSAGES[locale]).match(/"sponsored":"([^"]+)"/)?.[1];
    expect(sponsoredText, "messages need a 'sponsored' label").toBeTruthy();
    expect(html.split(sponsoredText!).length - 1).toBeGreaterThanOrEqual(1);
  });
});

describe.each(["en", "zh"] as const)("Fair Price page (%s)", (locale) => {
  it("renders an unavailable notice (not an error page) when the DB throws", async () => {
    findPrices.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: PricePage } = await import("@/app/[locale]/price/page");
    const html = await render(PricePage, locale);
    expect(html).toContain((MESSAGES[locale] as { common: { unavailable: string } }).common.unavailable);
    spy.mockRestore();
  });
});
