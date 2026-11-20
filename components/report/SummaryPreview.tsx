import { useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Download } from "lucide-react";
import { HOTLINES } from "@/lib/hotlines";
import { HotlineLink } from "@/components/shared/HotlineLink";
import { pickLang } from "@/components/shared/format";
import { downloadBlob, fetchPdf, type Summary } from "./report-api";
import { errorKeyFor, splitSummary } from "./report-state";

const Markdown = dynamic(() => import("@/components/shared/Markdown").then((m) => m.Markdown), {
  ssr: false,
  loading: () => <div className="h-24 animate-pulse rounded bg-muted" />,
});

const TOURIST_POLICE = HOTLINES.find((h) => h.key === "tourist_police")!;

export function NotPoliceReport() {
  const t = useTranslations("report.summary");
  const locale = useLocale();
  return (
    <aside
      role="note"
      aria-labelledby="not-police-h"
      className="space-y-2 rounded-xl border border-warning-foreground/30 bg-warning p-3 text-warning-foreground"
      data-testid="report-not-police"
    >
      <p id="not-police-h" className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {t("notPolice")}
      </p>
      <p className="text-sm">{t("notPoliceText")}</p>
      <HotlineLink
        variant="card"
        number={TOURIST_POLICE.number}
        label={pickLang(locale, TOURIST_POLICE.name_en, TOURIST_POLICE.name_zh)}
        className="text-foreground"
      />
    </aside>
  );
}

export function SummaryPreview({ summary }: { summary: Summary }) {
  const t = useTranslations("report.summary");
  const te = useTranslations("report.errors");
  const [pdf, setPdf] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pdfError, setPdfError] = useState("generic");
  const parts = splitSummary(summary.markdown);

  async function download() {
    setPdf("loading");
    const r = await fetchPdf(summary);
    if (!r.ok) {
      setPdfError(errorKeyFor("pdf", r.status, r.code));
      setPdf("error");
      return;
    }
    downloadBlob(r.data.blob, r.data.filename);
    setPdf("done");
  }

  return (
    <div className="space-y-3">
      <NotPoliceReport />
      <p className="text-sm text-muted-foreground">{t("checkHint")}</p>
      {parts ? (
        <>
          <section lang="th" aria-label={t("thai")} className="rounded-xl border bg-card p-3" data-testid="report-th">
            <Markdown>{parts.th}</Markdown>
          </section>
          <section lang="en" aria-label={t("english")} className="rounded-xl border bg-card p-3" data-testid="report-en">
            <Markdown>{parts.en}</Markdown>
          </section>
        </>
      ) : (
        <section className="rounded-xl border bg-card p-3" data-testid="report-md">
          <Markdown>{summary.markdown}</Markdown>
        </section>
      )}
      <button
        type="button"
        onClick={() => void download()}
        disabled={pdf === "loading"}
        data-testid="report-download-pdf"
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Download className="size-4" aria-hidden />
        {pdf === "loading" ? t("downloading") : t("downloadPdf")}
      </button>
      {pdf === "done" && (
        <p role="status" className="text-sm text-muted-foreground" data-testid="report-pdf-done">
          {t("downloaded")}
        </p>
      )}
      {pdf === "error" && (
        <p role="alert" className="text-sm text-destructive" data-testid="report-pdf-error">
          {te(pdfError)}
        </p>
      )}
    </div>
  );
}
