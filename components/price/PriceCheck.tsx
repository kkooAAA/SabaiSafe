"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import type { PriceRef, PriceUnit, UiLang } from "@/types/api";
import { selectRefs, verdictFor, type PriceVerdict } from "@/types/price-verdict";
import { HOTLINES } from "@/lib/hotlines";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/shared/Markdown";
import { HotlineLink } from "@/components/shared/HotlineLink";
import { formatThbRange, pickLang } from "@/components/shared/format";
import { aiErrorKey, postTextStream } from "@/components/shared/text-stream";
import { looksLikeOtherCurrency, parseQuoted, unitsOf, VERDICT_KEY } from "./quote";
import { filterPrices } from "./picker";

type Status = "idle" | "loading" | "done" | "error";
type Checked = { verdict: PriceVerdict; refs: PriceRef[] };

const inputCls =
  "h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none";

const VERDICT_STYLE: Record<PriceVerdict, string> = {
  "Within normal range": "bg-success text-success-foreground",
  "Above typical range": "bg-warning text-warning-foreground",
  "Far above typical range": "bg-emergency text-emergency-foreground",
  "No price quoted": "",
  "Not enough data": "",
};

const HELP_LINES = HOTLINES.filter((h) => h.key === "consumer" || h.key === "tourist_police");

/**
 * "I was quoted X": streams POST /api/chat/price for the selected item_key / area / unit.
 * The badge and the "compared with" rows come from types/price-verdict.ts with the SAME arguments as the request,
 * so badge, table and AI text agree. `itemRows` = all rows for this item_key (any area).
 */
export function PriceCheck({
  itemKey,
  area,
  itemRows,
  lang,
}: {
  itemKey: string;
  area: string | null;
  itemRows: PriceRef[];
  lang: UiLang;
}) {
  const locale = useLocale();
  const t = useTranslations("price");
  const te = useTranslations("errors");
  // Units the user can compare in this area (area rows + island-wide rows), in PRICE_UNITS order.
  const units = useMemo(() => unitsOf(filterPrices(itemRows, itemKey, area)), [itemRows, itemKey, area]);
  const [unit, setUnit] = useState<PriceUnit | null>(units[0] ?? null);
  const [quoted, setQuoted] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorKey, setErrorKey] = useState("generic");
  const [checked, setChecked] = useState<Checked | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    setText("");
    setStatus("idle");
    setChecked(null);
  };

  useEffect(() => () => abortRef.current?.abort(), []);
  // New item/area: drop the old answer and default to the first available unit.
  useEffect(() => {
    abortRef.current?.abort();
    setText("");
    setStatus("idle");
    setChecked(null);
    setUnit(units[0] ?? null);
  }, [units]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseQuoted(quoted);
    if (value === "invalid") {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    reset();
    const ac = new AbortController();
    abortRef.current = ac;
    setChecked({ verdict: verdictFor(itemRows, value, area, unit), refs: selectRefs(itemRows, area, unit) });
    setStatus("loading");
    try {
      const r = await postTextStream(
        "/api/chat/price",
        { item: itemKey, quoted: value, area, unit, lang },
        setText,
        ac.signal,
      );
      if (ac.signal.aborted) return;
      if (!r.ok) {
        setErrorKey(aiErrorKey(r.status, r.code) ?? "generic");
        setStatus("error");
      } else if (r.error) {
        setErrorKey("incomplete");
        setStatus("error");
      } else {
        setStatus("done");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setErrorKey("network");
      setStatus("error");
    }
  }

  const v = checked?.verdict;

  return (
    <section aria-labelledby="check-h" className="space-y-3 rounded-xl border bg-accent/40 p-4">
      <h2 id="check-h" className="flex items-center gap-2 font-semibold">
        <Sparkles className="size-4 text-primary" aria-hidden />
        {t("check.title")}
      </h2>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 basis-36 gap-1 text-sm font-medium">
            {t("check.quotedLabel")}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={quoted}
              onChange={(e) => {
                setQuoted(e.target.value);
                setInvalid(false);
                if (status !== "idle") reset();
              }}
              placeholder={t("check.quotedPlaceholder")}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "quoted-err" : undefined}
              className={inputCls}
            />
          </label>
          {units.length > 1 && (
            <label className="grid min-w-0 basis-28 gap-1 text-sm font-medium">
              {t("check.unitLabel")}
              <select
                className={inputCls}
                value={unit ?? ""}
                onChange={(e) => {
                  setUnit(e.target.value as PriceUnit);
                  reset();
                }}
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {t(`unit.${u}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="submit"
            disabled={status === "loading"}
            className="h-11 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {status === "loading" ? t("check.checking") : t("check.submit")}
          </button>
        </div>
        {invalid && (
          <p id="quoted-err" role="alert" className="text-sm text-destructive">
            {looksLikeOtherCurrency(quoted) ? t("check.otherCurrency") : t("check.invalidQuoted")}
          </p>
        )}
      </form>

      {checked && v && (
        <div className="space-y-2" data-verdict={VERDICT_KEY[v]}>
          {v !== "No price quoted" && v !== "Not enough data" && (
            <p className={cn("inline-flex rounded-full px-3 py-1 text-sm font-semibold", VERDICT_STYLE[v])}>
              {t(`verdict.${VERDICT_KEY[v]}`)}
            </p>
          )}
          {v === "Not enough data" ? (
            <div className="space-y-2">
              <p className="text-sm">{t("check.noDataHint")}</p>
              <ul className="grid gap-2">
                {HELP_LINES.map((h) => (
                  <li key={h.key}>
                    <HotlineLink variant="card" number={h.number} label={pickLang(locale, h.name_en, h.name_zh)} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-sm">
              <p className="text-muted-foreground">{t("check.comparedWith")}</p>
              <ul className="mt-1 space-y-0.5">
                {checked.refs.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold tabular-nums">{formatThbRange(r.min_thb, r.max_thb, locale)}</span>
                    <span>{t(`unit.${r.unit}`)}</span>
                    <span className="text-muted-foreground">· {r.area}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {text && (
        <div aria-live="polite" aria-busy={status === "loading" || undefined} className="rounded-lg bg-background p-3">
          <Markdown>{text}</Markdown>
        </div>
      )}
      {status === "error" && (
        <div role="alert" className="space-y-2" data-testid="price-check-error">
          <p className="text-sm text-destructive">{te(errorKey)}</p>
          {/* Resubmits the same form: item, area, unit and the quoted price are kept. */}
          <button
            type="button"
            onClick={() => formRef.current?.requestSubmit()}
            className="h-11 rounded-md border bg-background px-4 text-sm font-medium"
            data-testid="price-check-retry"
          >
            {t("check.retry")}
          </button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("check.note")}</p>
    </section>
  );
}
