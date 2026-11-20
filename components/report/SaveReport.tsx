import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { UiLang } from "@/types/api";
import { deleteSaved, saveSummary, type Summary } from "./report-api";
import {
  buildSaveRequest,
  clearSavedReport,
  errorKeyFor,
  saveReplacing,
  storeSavedReport,
  type SavedReport,
} from "./report-state";

/** Optional "Save for 30 days" with an UNTICKED consent checkbox (PDPA). */
export function SaveReport({
  summary,
  lang,
  previous,
  onSaved,
  onPreviousGone,
}: {
  summary: Summary;
  lang: UiLang;
  /** An earlier saved report on this device; saving deletes it first (only one id + token is kept). */
  previous: SavedReport | null;
  onSaved: (saved: SavedReport, remembered: boolean) => void;
  /** The earlier report was deleted (or already gone) but the new save failed. */
  onPreviousGone: () => void;
}) {
  const t = useTranslations("report.save");
  const te = useTranslations("report.errors");
  const id = useId();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function save() {
    const body = buildSaveRequest(summary, lang, consent);
    if (!body) return setErrorKey("consent_required");
    setBusy(true);
    setErrorKey(null);
    const r = await saveReplacing(previous, body, {
      deleteSaved,
      saveSummary,
      store: (x) => storeSavedReport(x),
      clear: () => clearSavedReport(),
    });
    setBusy(false);
    if (!r.ok) {
      if (r.previousGone) onPreviousGone();
      return setErrorKey(r.stage === "delete_old" ? "replace_failed" : errorKeyFor("save", r.status, r.code));
    }
    onSaved(r.saved, r.remembered);
  }

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-xl border bg-card p-3" data-testid="report-save">
      <h2 id={`${id}-h`} className="font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("text")}</p>
      {previous && (
        <p className="rounded-lg border border-warning-foreground/30 bg-warning p-2 text-sm text-warning-foreground" data-testid="report-save-replaces">
          {t("replaces")}
        </p>
      )}
      <label htmlFor={`${id}-c`} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-snug">
        <input
          id={`${id}-c`}
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            setErrorKey(null);
          }}
          data-testid="report-consent"
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span>{t("consent")}</span>
      </label>
      <button
        type="button"
        onClick={() => void save()}
        disabled={!consent || busy}
        data-testid="report-save-button"
        className="inline-flex h-11 w-full items-center justify-center rounded-md border bg-background px-4 text-sm font-medium disabled:opacity-50"
      >
        {busy ? t("saving") : t("button")}
      </button>
      {errorKey && (
        <p role="alert" className="text-sm text-destructive" data-testid="report-save-error">
          {te(errorKey)}
        </p>
      )}
    </section>
  );
}
