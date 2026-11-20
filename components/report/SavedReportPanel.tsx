import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ConfirmButton } from "./ConfirmButton";
import { deleteSaved, openSaved, type Summary } from "./report-api";
import { clearSavedReport, errorKeyFor, type SavedReport } from "./report-state";

export function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium" }).format(d);
}

type Props = {
  saved: SavedReport;
  /** "existing": found in localStorage; "just_saved": saved now; "no_storage": saved but the browser can't remember it. */
  mode: "existing" | "just_saved" | "no_storage";
  /** Hide "Open" when this summary is already on screen. */
  showOpen: boolean;
  onOpened: (s: Summary & { expires_at: string }) => void;
  /** Called after a delete, or when the server says the record is gone (404). */
  onGone: (reason: "deleted" | "not_found") => void;
};

export function SavedReportPanel({ saved, mode, showOpen, onOpened, onGone }: Props) {
  const t = useTranslations("report.save");
  const te = useTranslations("report.errors");
  const locale = useLocale();
  const [busy, setBusy] = useState<"open" | "delete" | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const date = formatDate(saved.expires_at, locale);

  async function run(action: "open" | "delete") {
    setBusy(action);
    setErrorKey(null);
    const r = action === "open" ? await openSaved(saved) : await deleteSaved(saved);
    setBusy(null);
    if (!r.ok) {
      if (r.status === 404) {
        clearSavedReport();
        onGone("not_found");
        return;
      }
      setErrorKey(errorKeyFor(action, r.status, r.code));
      return;
    }
    if (action === "delete") {
      clearSavedReport();
      onGone("deleted");
    } else if (r.data) {
      onOpened(r.data);
    }
  }

  const text = mode === "existing" ? t("existing", { date }) : mode === "no_storage" ? t("noStorage") : t("saved", { date });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-3" data-testid="report-saved" data-mode={mode}>
      <p role="status" className="text-sm">
        {text}
      </p>
      <div className="flex flex-wrap gap-2">
        {showOpen && (
          <button
            type="button"
            onClick={() => void run("open")}
            disabled={busy !== null}
            data-testid="report-open-saved"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy === "open" ? t("opening") : t("open")}
          </button>
        )}
        <ConfirmButton
          label={busy === "delete" ? t("deleting") : t("delete")}
          question={t("confirmDelete")}
          confirmLabel={t("delete")}
          onConfirm={() => void run("delete")}
          disabled={busy !== null}
          danger
          testId="report-delete-saved"
        />
      </div>
      {errorKey && (
        <p role="alert" className="text-sm text-destructive" data-testid="report-saved-error">
          {te(errorKey)}
        </p>
      )}
    </section>
  );
}
