"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { BUSINESS_CRITERIA } from "@/types/protocol";
import type { Business, BusinessCategory } from "@/types/api";
import { cn } from "@/lib/utils";
import { BusinessCard } from "./BusinessCard";
import { businessCategories, filterBusinesses, orderBusinesses } from "./trusted";

/** Trusted Services: ordered by name only (sponsorship never reorders), category chips, criteria legend. */
export function BusinessDirectory({ businesses }: { businesses: Business[] }) {
  const t = useTranslations("help");
  const tc = useTranslations("common");
  const ordered = useMemo(() => orderBusinesses(businesses), [businesses]);
  const categories = useMemo(() => businessCategories(ordered), [ordered]);
  const [category, setCategory] = useState<BusinessCategory | null>(null);
  const shown = filterBusinesses(ordered, category);
  const chips: (BusinessCategory | null)[] = [null, ...categories];

  return (
    <section id="trusted" aria-labelledby="biz-h" className="scroll-mt-28 space-y-3" data-testid="trusted-services">
      <h2 id="biz-h" className="text-lg font-semibold">
        {t("businessesTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("businessesNote")}</p>
      <p className="flex gap-2 rounded-lg border bg-muted/50 p-3 text-xs" data-testid="trusted-disclaimer">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t("notEndorsement")}</span>
      </p>
      <details className="rounded-lg border bg-card px-3 text-sm" data-testid="criteria-help">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">{t("criteriaHelpTitle")}</summary>
        <dl className="space-y-2 pb-3">
          {BUSINESS_CRITERIA.map((k) => (
            <div key={k}>
              <dt className="font-medium">{t(`criteria.${k}`)}</dt>
              <dd className="text-muted-foreground">{t(`criteriaHelp.${k}`)}</dd>
            </div>
          ))}
        </dl>
      </details>

      {categories.length > 1 && (
        <div role="group" aria-label={t("filterLabel")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {chips.map((c) => {
            const active = c === category;
            return (
              <button
                key={c ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-background active:bg-accent",
                )}
              >
                {c ? t(`businessCategory.${c}`) : tc("all")}
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noBusinesses")}</p>
      ) : (
        <ul className="grid gap-3" aria-live="polite">
          {shown.map((b) => (
            <li key={b.id}>
              <BusinessCard business={b} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
