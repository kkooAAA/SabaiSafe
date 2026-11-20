import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import type { LegalSource } from "@/types/api";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { safeUrl } from "@/components/shared/format";
import { showSection, sourceAnchor } from "./parse";

/** Citations from the SOURCES trailer. Each card is the target of the "[n]" links in the answer. */
export function SourceList({ sources }: { sources: readonly LegalSource[] }) {
  const t = useTranslations("legal");
  const hasDraft = sources.some((s) => s.status !== "VERIFIED");
  return (
    <section aria-labelledby="sources-h" className="space-y-2">
      <h2 id="sources-h" className="font-semibold">
        {t("sourcesTitle")}
      </h2>
      {hasDraft && <p className="text-xs text-muted-foreground">{t("draftNote")}</p>}
      <ol className="grid gap-2">
        {sources.map((s) => {
          const url = safeUrl(s.source_url);
          return (
            <li
              key={s.id}
              id={sourceAnchor(s.id)}
              data-status={s.status}
              className="scroll-mt-28 rounded-lg border bg-card p-3 text-sm target:ring-2 target:ring-primary"
            >
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <span className="shrink-0 rounded bg-accent px-1.5 text-xs font-semibold leading-5 text-primary">
                  [{s.id}]
                </span>
                <span className="min-w-0 flex-1 font-medium leading-snug [overflow-wrap:anywhere]">{s.title}</span>
                {s.status === "VERIFIED" ? <StatusBadge kind="verified" /> : <StatusBadge kind="draft" />}
              </div>
              {(s.law || s.law_th) && (
                <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {s.law}
                  {s.law && s.law_th ? " · " : ""}
                  {s.law_th && <span lang="th">{s.law_th}</span>}
                </p>
              )}
              {(showSection(s.section) || s.location) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {showSection(s.section) && (
                    <span>
                      {t("section")}: {s.section}
                    </span>
                  )}
                  {showSection(s.section) && s.location ? " · " : ""}
                  {s.location && (
                    <span>
                      {t("location")}: {s.location}
                    </span>
                  )}
                </p>
              )}
              {s.excerpt && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-primary">{t("excerpt")}</summary>
                  <p className="mt-1 text-xs whitespace-pre-line [overflow-wrap:anywhere]">{s.excerpt}</p>
                </details>
              )}
              <p className="mt-1.5 text-xs">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-8 items-center gap-1 text-primary underline underline-offset-2"
                  >
                    {t("openSource")}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span className="text-muted-foreground">{t("noLink")}</span>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
