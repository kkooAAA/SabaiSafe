"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export function LocaleSwitch() {
  const t = useTranslations("locale");
  const locale = useLocale();
  const pathname = usePathname();
  const next = locale === "zh" ? "en" : "zh";
  return (
    <Link
      href={pathname}
      locale={next}
      hrefLang={next === "zh" ? "zh-CN" : "en"}
      aria-label={t("switchTo")}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-medium active:bg-accent"
    >
      <Languages className="size-4" aria-hidden />
      <span lang={next === "zh" ? "zh-CN" : "en"}>{t(`name.${next}`)}</span>
    </Link>
  );
}
