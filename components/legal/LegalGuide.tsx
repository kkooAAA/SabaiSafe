"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Info, Search, Square } from "lucide-react";
import type { UiLang } from "@/types/api";
import { HOTLINES } from "@/lib/hotlines";
import { HotlineLink } from "@/components/shared/HotlineLink";
import { pickLang } from "@/components/shared/format";
import { aiErrorKey, postTextStream } from "@/components/shared/text-stream";
import { EmergencyBanner } from "./EmergencyBanner";
import { SourceList } from "./SourceList";
import { linkCitations, looksUrgent, parseLegalStream, stripDisclaimer, type LegalParse } from "./parse";

// react-markdown is only needed once an answer streams in.
const Markdown = dynamic(() => import("@/components/shared/Markdown").then((m) => m.Markdown), {
  ssr: false,
  loading: () => null,
});

export const MAX_QUESTION = 1000; // ChatRequest.question max (types/api.ts)
const EXAMPLE_KEYS = ["scam", "transport", "rental", "alcohol_drugs", "beach_rules"] as const;
const ERROR_KEYS = ["rate_limited", "unavailable", "invalid"];

type Status = "idle" | "loading" | "done" | "error" | "stopped";

export function LegalGuide() {
  const lang = (useLocale() === "zh" ? "zh" : "en") satisfies UiLang;
  const t = useTranslations("legal");
  const te = useTranslations("errors");
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [inputError, setInputError] = useState<"empty" | "tooLong" | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [parsed, setParsed] = useState<LegalParse | null>(null);
  const [errorKey, setErrorKey] = useState("generic");
  const abortRef = useRef<AbortController | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(q: string) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAsked(q);
    setParsed(null);
    setStatus("loading");
    requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const r = await postTextStream(
        "/api/chat",
        { question: q, lang },
        (text) => {
          if (!ac.signal.aborted) setParsed(parseLegalStream(text, false));
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      if (!r.ok) {
        setErrorKey(aiErrorKey(r.status, r.code) ?? (ERROR_KEYS.includes(r.code) ? r.code : r.status === 400 ? "invalid" : "generic"));
        setStatus("error");
        return;
      }
      const final = parseLegalStream(r.text, true);
      setParsed(r.error ? { ...final, state: "error" } : final);
      if (r.error || final.state === "error") {
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return setInputError("empty");
    if (q.length > MAX_QUESTION) return setInputError("tooLong");
    setInputError(null);
    void ask(q);
  }

  function stop() {
    abortRef.current?.abort();
    setStatus("stopped");
  }

  const trailer = parsed?.trailer ?? null;
  const ids = useMemo(() => new Set(trailer?.sources.map((s) => s.id) ?? []), [trailer]);
  const disclaimer = t("disclaimer");
  const answer = useMemo(
    () => linkCitations(stripDisclaimer(parsed?.answer ?? "", [disclaimer]), ids),
    [parsed?.answer, disclaimer, ids],
  );
  const urgent = !!asked && (looksUrgent(asked) || trailer?.meta.is_emergency === true);
  const noAnswer = trailer?.meta.no_answer === true;
  const loading = status === "loading";

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} noValidate className="grid gap-2">
        <label htmlFor="legal-q" className="text-sm font-medium">
          {t("askLabel")}
        </label>
        <textarea
          id="legal-q"
          rows={3}
          value={question}
          maxLength={MAX_QUESTION}
          onChange={(e) => {
            setQuestion(e.target.value);
            setInputError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={t("placeholder")}
          aria-invalid={inputError ? true : undefined}
          aria-describedby={inputError ? "legal-q-err" : "legal-q-count"}
          className="w-full min-w-0 resize-y rounded-md border bg-background px-3 py-2 text-base shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        />
        <div className="flex items-center gap-2">
          <span id="legal-q-count" className="mr-auto text-xs text-muted-foreground tabular-nums">
            {question.length}/{MAX_QUESTION}
          </span>
          {loading ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-11 items-center gap-1.5 rounded-md border bg-background px-4 text-sm font-medium"
            >
              <Square className="size-3.5" aria-hidden />
              {t("stop")}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Search className="size-4" aria-hidden />
            {loading ? t("asking") : t("submit")}
          </button>
        </div>
        {inputError && (
          <p id="legal-q-err" role="alert" className="text-sm text-destructive">
            {inputError === "empty" ? t("empty") : t("tooLong", { max: MAX_QUESTION })}
          </p>
        )}
      </form>

      {!asked && (
        <section aria-labelledby="examples-h" className="space-y-2">
          <h2 id="examples-h" className="text-sm font-semibold">
            {t("examplesTitle")}
          </h2>
          <ul className="grid gap-2">
            {EXAMPLE_KEYS.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => {
                    const q = t(`examples.${k}.q`);
                    setQuestion(q);
                    setInputError(null);
                    void ask(q);
                  }}
                  className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-lg border bg-card px-3 py-2 text-left text-sm shadow-xs active:bg-accent"
                >
                  <span className="text-xs font-semibold text-primary">{t(`examples.${k}.label`)}</span>
                  <span className="leading-snug">{t(`examples.${k}.q`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div ref={answerRef} className="scroll-mt-28 space-y-4" aria-live="polite" aria-busy={loading || undefined}>
        {asked && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm [overflow-wrap:anywhere]">
            <span className="sr-only">{t("yourQuestion")}: </span>
            {asked}
          </p>
        )}

        {urgent && <EmergencyBanner />}

        {loading && !answer && (
          <div role="status" className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
            <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        )}

        {answer && (
          <section aria-labelledby="answer-h" className="space-y-2 rounded-xl border bg-card p-3" data-state={parsed?.state}>
            <h2 id="answer-h" className="sr-only">
              {t("answerTitle")}
            </h2>
            <Markdown>{answer}</Markdown>
          </section>
        )}

        {status === "done" && noAnswer && (
          <section aria-labelledby="noanswer-h" className="space-y-2" data-testid="no-answer">
            <h2 id="noanswer-h" className="font-semibold">
              {t("noAnswerTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("noAnswerHint")}</p>
            <ul className="grid gap-2">
              {HOTLINES.map((h) => (
                <li key={h.key}>
                  <HotlineLink variant="card" number={h.number} label={pickLang(lang, h.name_en, h.name_zh)} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {trailer && trailer.sources.length > 0 && <SourceList sources={trailer.sources} />}

        {status === "done" && parsed?.state === "bad_trailer" && (
          <p role="status" className="rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground">
            {t("noSources")}
          </p>
        )}
        {status === "done" && parsed?.state === "incomplete" && (
          <p role="status" className="rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground">
            {t("incomplete")}
          </p>
        )}
        {status === "stopped" && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("stopped")}
          </p>
        )}
        {status === "error" && (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3">
            <p className="text-sm text-destructive">{te(errorKey)}</p>
            {asked && errorKey !== "invalid" && (
              <button
                type="button"
                onClick={() => void ask(asked)}
                className="h-11 rounded-md border bg-background px-4 text-sm font-medium"
              >
                {t("retry")}
              </button>
            )}
          </div>
        )}
      </div>

      <aside aria-labelledby="disclaimer-h" className="flex gap-2 rounded-lg border bg-muted/50 p-3 text-xs" data-testid="legal-disclaimer">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p>
          <strong id="disclaimer-h" className="font-semibold">
            {t("disclaimerTitle")}:
          </strong>{" "}
          {disclaimer}
        </p>
      </aside>
    </div>
  );
}
