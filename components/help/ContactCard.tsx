import { useLocale, useTranslations } from "next-intl";
import type { HelpContact } from "@/types/api";
import { pickLang } from "@/components/shared/format";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ExternalLinks } from "@/components/shared/ExternalLinks";

export function ContactCard({ contact: c }: { contact: HelpContact }) {
  const locale = useLocale();
  const t = useTranslations("help");
  return (
    <article className="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{pickLang(locale, c.name_en, c.name_zh)}</h3>
          {c.name_th && (
            <p lang="th" className="text-sm text-muted-foreground">
              {c.name_th}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusBadge kind={c.verified ? "verified" : "unverified"} />
          {c.is_sample && <StatusBadge kind="sample" />}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {c.area && (
          <>
            <dt className="text-muted-foreground">{t("area")}</dt>
            <dd>{c.area}</dd>
          </>
        )}
        {c.address && (
          <>
            <dt className="text-muted-foreground">{t("address")}</dt>
            <dd>{c.address}</dd>
          </>
        )}
        {c.hours && (
          <>
            <dt className="text-muted-foreground">{t("hours")}</dt>
            <dd>{c.hours}</dd>
          </>
        )}
        {c.languages.length > 0 && (
          <>
            <dt className="text-muted-foreground">{t("languages")}</dt>
            <dd>{c.languages.map((l) => t.has(`lang.${l}`) ? t(`lang.${l}`) : l).join(", ")}</dd>
          </>
        )}
      </dl>
      {!c.phone && <p className="text-xs text-muted-foreground">{t("noPhone")}</p>}
      <ExternalLinks phone={c.phone} mapUrl={c.google_maps_url} website={c.website} sourceUrl={c.source_url} />
    </article>
  );
}
