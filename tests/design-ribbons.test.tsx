// @vitest-environment jsdom
// qa 2026-11-23: "longtail ribbons" redesign. Ribbon mapping, home rows + Tourist Police block in en/zh,
// aria-current on the locale switch and bottom nav, Thai preview font, reduced motion, hotlines only from lib/hotlines.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { HOTLINES, HOTLINE_NUMBERS } from "@/lib/hotlines";
import { NAV_ITEMS, RIBBON_BG, RIBBON_TITLE, ribbonOf, type Ribbon } from "@/components/shell/nav-items";
import { Markdown } from "@/components/shared/Markdown";
import { FACTS, MARKDOWN } from "./helpers/report";

const MESSAGES = { en, zh } as const;
let pathname = "/";

vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("next/dynamic", () => ({ default: () => Markdown }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; locale?: string; children: React.ReactNode }) => (
    <a href={href} {...{ ...rest, locale: undefined }}>
      {children}
    </a>
  ),
  usePathname: () => pathname,
}));

const { default: Home } = await import("@/app/[locale]/page");
const { LocaleSwitch } = await import("@/components/shell/LocaleSwitch");
const { BottomNav } = await import("@/components/shell/BottomNav");
const { SummaryPreview } = await import("@/components/report/SummaryPreview");

const wrap = (locale: "en" | "zh", el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Bangkok">
      {el}
    </NextIntlClientProvider>,
  );
const doc = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

describe("ribbon mapping (nav-items)", () => {
  const RIBBONS: Ribbon[] = ["ink", "legal", "report", "price", "help"];
  it("each feature has its own ribbon; home is ink", () => {
    expect(Object.fromEntries(NAV_ITEMS.map((n) => [n.key, n.ribbon]))).toEqual({
      home: "ink",
      legal: "legal",
      report: "report",
      price: "price",
      help: "help",
    });
    expect(new Set(NAV_ITEMS.map((n) => n.ribbon)).size).toBe(NAV_ITEMS.length);
    expect(ribbonOf("price")).toBe("price");
  });
  it("class maps are literal Tailwind classes backed by tokens in globals.css", () => {
    const css = readFileSync("app/globals.css", "utf8");
    for (const r of RIBBONS) {
      const token = r === "ink" ? "ink" : `ribbon-${r}`;
      expect(RIBBON_BG[r]).toBe(`bg-${token}`);
      expect(RIBBON_TITLE[r]).toContain(`border-${token}`);
      expect(css).toContain(`--color-${token}: var(--${token})`);
    }
  });
  it("palette tokens match the agreed design", () => {
    const css = readFileSync("app/globals.css", "utf8").toLowerCase();
    for (const [name, hex] of [
      ["ink", "#0e2a33"],
      ["daylight", "#f7fafa"],
      ["ribbon-legal", "#2f4bb8"],
      ["ribbon-report", "#6a3fa0"],
      ["ribbon-price", "#e0a21a"],
      ["ribbon-help", "#d0312d"],
    ]) {
      expect(css).toMatch(new RegExp(`--${name}: ${hex};`));
    }
    expect(css).toContain("--primary: var(--ink)");
    expect(css).toContain("--ribbon-price-foreground: #0e2a33"); // white on marigold fails contrast
  });
});

describe("reduced motion", () => {
  it("the ribbon animation is only applied behind motion-safe, and a reduce media block exists", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
      });
    for (const f of [...files("components"), ...files("app")]) {
      const src = readFileSync(f, "utf8");
      const uses = src.match(/[\w:-]*animate-ribbon-in/g) ?? [];
      for (const u of uses) expect(u, f).toBe("motion-safe:animate-ribbon-in");
    }
  });
});

describe.each(["en", "zh"] as const)("home (%s)", (locale) => {
  // A pre-fulfilled thenable so React use() reads it synchronously in renderToStaticMarkup.
  const params = Object.assign(Promise.resolve({ locale }), { status: "fulfilled", value: { locale } });
  const d = doc(wrap(locale, <Home params={params} />));

  it("renders 4 feature rows in situation order, each with its ribbon stripe", () => {
    const rows = [...d.querySelectorAll("ul > li > a")];
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/price", "/legal", "/report", "/help"]);
    rows.forEach((a, i) => {
      const key = (["price", "legal", "report", "help"] as const)[i]!;
      expect(a.querySelector("span[aria-hidden]")?.className).toContain(RIBBON_BG[key]);
      expect(a.textContent).toContain(MESSAGES[locale].home.tiles[key].title);
    });
  });

  it("has the Tourist Police block with tel:1155 from lib/hotlines", () => {
    const tp = HOTLINES.find((h) => h.key === "tourist_police")!;
    const block = d.querySelector('section[aria-labelledby="tp-label"]')!;
    expect(block).not.toBeNull();
    expect(block.querySelector("#tp-label")?.textContent).toBe(MESSAGES[locale].emergency.short.tourist_police);
    expect(block.textContent).toContain(tp.number);
    const call = block.querySelector('a[href^="tel:"]')!;
    expect(call.getAttribute("href")).toBe("tel:1155");
    expect(call.textContent).toBe(MESSAGES[locale].home.call.replace("{number}", "1155"));
  });

  it("shows no phone number that is not a hotline", () => {
    for (const a of d.querySelectorAll('a[href^="tel:"]')) {
      expect(HOTLINE_NUMBERS).toContain(a.getAttribute("href")!.slice(4));
    }
    const digits = (d.textContent ?? "").match(/\d{3,}/g) ?? [];
    for (const n of digits) expect(HOTLINE_NUMBERS).toContain(n);
  });
});

describe.each(["en", "zh"] as const)("shell a11y (%s)", (locale) => {
  it("locale switch marks only the current language with aria-current and per-link lang", () => {
    const d = doc(wrap(locale, <LocaleSwitch />));
    const links = [...d.querySelectorAll("a")];
    expect(links).toHaveLength(2);
    const current = links.filter((a) => a.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute("lang")).toBe(locale === "zh" ? "zh-CN" : "en");
    expect(links.map((a) => a.getAttribute("lang"))).toEqual(["en", "zh-CN"]);
    expect(links.map((a) => a.textContent)).toEqual(["EN", "中"]);
  });

  it.each([
    ["/", "home"],
    ["/legal", "legal"],
    ["/price/x", "price"],
  ] as const)("bottom nav at %s: aria-current=page on %s with its ribbon indicator", (path, key) => {
    pathname = path;
    const d = doc(wrap(locale, <BottomNav />));
    const cur = [...d.querySelectorAll('a[aria-current="page"]')];
    expect(cur).toHaveLength(1);
    expect(cur[0]!.getAttribute("href")).toBe(NAV_ITEMS.find((n) => n.key === key)!.href);
    expect(cur[0]!.querySelector("span[aria-hidden]")?.className).toContain(RIBBON_BG[ribbonOf(key)]);
    // Active state is not colour-only: bold + ink text.
    expect(cur[0]!.className).toContain("font-bold");
    pathname = "/";
  });
});

describe("Thai report preview font", () => {
  it.each(["en", "zh"] as const)("the Thai section uses font-thai (Sarabun) and lang=th; others do not (%s)", (locale) => {
    const d = doc(wrap(locale, <SummaryPreview summary={{ facts: FACTS, markdown: MARKDOWN }} />));
    const th = d.querySelector('[data-testid="report-th"]')!;
    expect(th.getAttribute("lang")).toBe("th");
    expect(th.className.split(/\s+/)).toContain("font-thai");
    expect(d.querySelector('[data-testid="report-en"]')!.className).not.toContain("font-thai");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/--font-thai: var\(--font-sarabun\)/);
  });
});
