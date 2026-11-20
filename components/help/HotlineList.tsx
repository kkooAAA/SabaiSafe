import { useLocale, useTranslations } from "next-intl";
import { HotlineLink } from "@/components/shared/HotlineLink";
import { pickLang } from "@/components/shared/format";
import type { Hotline } from "./merge-contacts";

/** The four hotlines from lib/hotlines.ts. Rendered even when the DB is down. */
export function HotlineList({ hotlines }: { hotlines: readonly Hotline[] }) {
  const locale = useLocale();
  const t = useTranslations("help");
  return (
    <section aria-labelledby="hotlines-h" className="space-y-2">
      <h2 id="hotlines-h" className="text-lg font-semibold">
        {t("hotlinesTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hotlinesNote")}</p>
      <ul className="grid gap-2">
        {hotlines.map((h) => (
          <li key={h.key}>
            <HotlineLink variant="card" number={h.number} label={pickLang(locale, h.name_en, h.name_zh)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
