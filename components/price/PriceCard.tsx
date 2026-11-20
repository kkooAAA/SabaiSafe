import { Scale } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { PriceRef } from "@/types/api";
import { formatThbRange, pickLang, safeUrl } from "@/components/shared/format";
import { StatusBadge } from "@/components/shared/StatusBadge";

export function PriceCard({ row: r }: { row: PriceRef }) {
  const locale = useLocale();
  const t = useTranslations("price");
  const notes = pickLang(locale, r.notes, r.notes_zh);
  const src = safeUrl(r.source_url);
  return (
    <article className="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{pickLang(locale, r.item_name_en, r.item_name_zh)}</h3>
          <p className="text-sm text-muted-foreground">{r.area}</p>
        </div>
        {r.is_sample && <StatusBadge kind="sample" />}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-bold tabular-nums">{formatThbRange(r.min_thb, r.max_thb, locale)}</span>
        <span className="text-sm text-muted-foreground">{t(`unit.${r.unit}`)}</span>
      </p>
      {r.is_fixed_by_law && (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-xs font-medium text-primary">
          <Scale className="size-3.5" aria-hidden />
          {t("fixedByLaw")}
        </p>
      )}
      {notes && <p className="text-sm">{notes}</p>}
      <p className="text-xs text-muted-foreground">
        {t("sourceLine", { date: r.collected_at })}{" "}
        {src ? (
          <a href={src} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {r.source}
          </a>
        ) : (
          <span>{r.source}</span>
        )}
      </p>
    </article>
  );
}
