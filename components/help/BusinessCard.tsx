import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Business } from "@/types/api";
import { pickLang } from "@/components/shared/format";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ExternalLinks } from "@/components/shared/ExternalLinks";
import { metCriteria } from "./trusted";

export function BusinessCard({ business: b }: { business: Business }) {
  const locale = useLocale();
  const t = useTranslations("help");
  const criteria = metCriteria(b.criteria_met);
  const desc = pickLang(locale, b.description_en, b.description_zh);
  return (
    <article className="space-y-2 rounded-xl border bg-card p-4 shadow-xs" data-sponsored={b.is_sponsored || undefined} data-testid="business-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{pickLang(locale, b.name, b.name_zh)}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`businessCategory.${b.category}`)} · {b.area}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {b.is_sponsored && <StatusBadge kind="sponsored" />}
          {b.is_sample && <StatusBadge kind="sample" />}
        </div>
      </div>
      {desc && <p className="text-sm">{desc}</p>}
      {criteria.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("criteriaLabel")}>
          {criteria.map((k) => (
            <li key={k} className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs text-success-foreground">
              <Check className="size-3" aria-hidden />
              {t(`criteria.${k}`)}
            </li>
          ))}
        </ul>
      )}
      {b.verified_at && <p className="text-xs text-muted-foreground">{t("checkedOn", { date: b.verified_at })}</p>}
      <ExternalLinks phone={b.phone} mapUrl={b.google_maps_url} website={b.website} sourceUrl={b.source_url} />
    </article>
  );
}
