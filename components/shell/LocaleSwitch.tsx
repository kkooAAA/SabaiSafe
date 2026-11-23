"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/** Segmented EN | 中 control on the ink header. The current language is marked with aria-current. */
export function LocaleSwitch() {
  const t = useTranslations("locale");
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <div role="group" aria-label={t("switchTo")} className="flex rounded-lg border border-white/40 p-0.5">
      {routing.locales.map((l) => {
        const current = l === locale;
        const lang = l === "zh" ? "zh-CN" : "en";
        return (
          <Link
            key={l}
            href={pathname}
            locale={l}
            hrefLang={lang}
            lang={lang}
            aria-current={current ? "true" : undefined}
            aria-label={t(`name.${l}`)}
            className={cn(
              "inline-flex min-h-10 min-w-11 items-center justify-center rounded-md px-3 text-base font-bold leading-none",
              current ? "bg-white text-ink" : "text-white active:bg-white/15",
            )}
          >
            {t(`short.${l}`)}
          </Link>
        );
      })}
    </div>
  );
}
