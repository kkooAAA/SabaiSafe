"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PriceRef, UiLang } from "@/types/api";
import { PriceCard } from "./PriceCard";
import dynamic from "next/dynamic";

// Loaded only when an item is picked: it pulls in react-markdown (and zod via types/api.ts).
const PriceCheck = dynamic(() => import("./PriceCheck").then((m) => m.PriceCheck), { ssr: false });
import { buildAreas, buildItemGroups, filterPrices, sortPrices } from "./picker";

const selectCls =
  "h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none";

export function PriceExplorer({ rows }: { rows: PriceRef[] }) {
  const lang = (useLocale() === "zh" ? "zh" : "en") satisfies UiLang;
  const t = useTranslations("price");
  const [item, setItem] = useState<string>("");
  const [area, setArea] = useState<string>("");

  const groups = useMemo(() => buildItemGroups(rows, lang), [rows, lang]);
  const areas = useMemo(() => buildAreas(rows), [rows]);
  const sorted = useMemo(() => sortPrices(rows, lang), [rows, lang]);
  const shown = filterPrices(sorted, item || null, area || null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:max-w-2xl md:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          {t("itemLabel")}
          <select className={selectCls} value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">{t("allItems")}</option>
            {groups.map((g) => (
              <optgroup key={g.category} label={t(`category.${g.category}`)}>
                {g.items.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("areaLabel")}
          <select className={selectCls} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">{t("allAreas")}</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>
      {item && (
        <div className="md:max-w-2xl">
          <PriceCheck key={item} itemKey={item} area={area || null} itemRows={filterPrices(rows, item, null)} lang={lang} />
        </div>
      )}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("resultCount", { count: shown.length })}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noResults")}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 md:[&>li>*]:h-full">
          {shown.map((r) => (
            <li key={r.id}>
              <PriceCard row={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
