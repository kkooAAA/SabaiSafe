// Pure display helpers shared by pages and components (no React, unit-testable).
import type { UiLang } from "@/types/api";

/** `tel:` href for a stored phone ("1155" or "+66 76 123 456"). Keeps digits and a leading +. */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** Localized text with English fallback when the zh field is null/empty. */
export function pickLang(lang: UiLang | string, en: string, zh: string | null | undefined): string;
export function pickLang(lang: UiLang | string, en: string | null, zh: string | null | undefined): string | null;
export function pickLang(lang: UiLang | string, en: string | null, zh: string | null | undefined): string | null {
  if (lang === "zh" && zh && zh.trim()) return zh;
  return en;
}

/** "฿1,200" or "฿300–500" for a min/max THB range. */
export function formatThbRange(min: number, max: number, locale: string): string {
  const fmt = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 2 });
  return min === max ? `฿${fmt.format(min)}` : `฿${fmt.format(min)}–${fmt.format(max)}`;
}

/** Only allow http(s) links from data into hrefs. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
