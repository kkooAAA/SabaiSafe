"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UiLang } from "@/types/api";
import { postTextStream } from "@/components/shared/text-stream";
import { ConfirmButton } from "@/components/shared/ConfirmButton";
import { InterviewChat, type ChatStatus } from "./InterviewChat";
import { PrivacyNotice } from "./PrivacyNotice";
import { SaveReport } from "./SaveReport";
import { SavedReportPanel, formatDate } from "./SavedReportPanel";
import { SummaryPreview } from "./SummaryPreview";
import { generateSummary, type Summary } from "./report-api";
import {
  appendUserMessage,
  buildChatRequest,
  buildGenerateRequest,
  canRetry,
  commitReply,
  errorKeyFor,
  loadSavedReport,
  parseInterviewReply,
  type Msg,
  type SavedReport,
} from "./report-state";

type Step = "notice" | "chat" | "summary";
type SavedMode = "existing" | "just_saved" | "no_storage";

export function ReportAssistant() {
  const lang = (useLocale() === "zh" ? "zh" : "en") satisfies UiLang;
  const locale = useLocale();
  const t = useTranslations("report");
  const [step, setStep] = useState<Step>("notice");

  // Interview
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Summary
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryExpires, setSummaryExpires] = useState<string | null>(null); // set when the summary on screen is saved

  // Saved record (localStorage holds id + token only)
  const [saved, setSaved] = useState<SavedReport | null>(null);
  const [savedMode, setSavedMode] = useState<SavedMode>("existing");
  const [flash, setFlash] = useState<"deleted" | "not_found" | null>(null);
  // When the browser cannot remember the record, keep it in memory for this page view so Delete still works.
  const [noStorageRecord, setNoStorageRecord] = useState<SavedReport | null>(null);
  const record = saved ?? noStorageRecord;
  const topRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSaved(loadSavedReport());
    return () => abortRef.current?.abort();
  }, []);

  function goTo(s: Step) {
    setStep(s);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function runChat(msgs: Msg[]) {
    const body = buildChatRequest(msgs, lang);
    if (!body) {
      setErrorKey("too_long_or_invalid");
      setStatus("error");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setMessages(msgs);
    setReady(false);
    setStreaming("");
    setErrorKey(null);
    setGenerateError(null);
    setStatus("loading");
    try {
      const r = await postTextStream(
        "/api/report/chat",
        body,
        (text) => {
          if (!ac.signal.aborted) setStreaming(parseInterviewReply(text, false).text);
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setStreaming(null);
      if (!r.ok) {
        setErrorKey(errorKeyFor("chat", r.status, r.code));
        setStatus("error");
        return;
      }
      const fin = parseInterviewReply(r.text, true);
      if (r.error || (!fin.text && !fin.ready)) {
        setErrorKey("incomplete");
        setStatus("error");
        return;
      }
      setMessages(commitReply(msgs, fin.text));
      setReady(fin.ready);
      setStatus("idle");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStreaming(null);
      setErrorKey("network");
      setStatus("error");
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(null);
    setStatus("stopped");
  }

  function startOver() {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(null);
    setStatus("idle");
    setErrorKey(null);
    setReady(false);
    setSummary(null);
    setSummaryExpires(null);
    setGenerateError(null);
    goTo("chat");
  }

  async function generate() {
    const body = buildGenerateRequest(messages);
    if (!body) return setGenerateError("too_long_or_invalid");
    setGenerating(true);
    setGenerateError(null);
    try {
      const r = await generateSummary(body);
      if (!r.ok) return setGenerateError(errorKeyFor("generate", r.status, r.code));
      setSummary(r.data);
      setSummaryExpires(null);
      setFlash(null);
      goTo("summary");
    } finally {
      setGenerating(false);
    }
  }

  function onSaved(s: SavedReport, remembered: boolean) {
    setSaved(remembered ? s : null);
    setSavedMode(remembered ? "just_saved" : "no_storage");
    setSummaryExpires(s.expires_at);
    setNoStorageRecord(remembered ? null : s);
  }

  function onOpened(s: Summary & { expires_at: string }) {
    setSummary({ facts: s.facts, markdown: s.markdown });
    setSummaryExpires(s.expires_at);
    setSavedMode("existing");
    setFlash(null);
    goTo("summary");
  }

  function onGone(reason: "deleted" | "not_found") {
    setSaved(null);
    setNoStorageRecord(null);
    setFlash(reason);
    setSummaryExpires(null);
    // A summary opened from the server (no conversation in memory) is cleared from the screen too.
    if (step === "summary" && messages.length === 0) {
      setSummary(null);
      goTo("notice");
    }
  }

  const retry = canRetry(messages) && (status === "error" || status === "stopped") ? () => void runChat(messages) : null;
  const summaryIsSaved = summaryExpires !== null;

  return (
    // md+: the notice and the chat keep a comfortable reading width (~42rem); the summary step uses the full width at lg.
    <div ref={topRef} className={cn("scroll-mt-28 space-y-4", step !== "summary" && "md:max-w-2xl")} data-step={step}>
      {flash && (
        <p
          role="status"
          className="rounded-lg border bg-muted p-3 text-sm"
          data-testid={flash === "deleted" ? "report-deleted" : "report-not-found"}
        >
          {flash === "deleted" ? t("save.deleted") : t("errors.not_found")}
        </p>
      )}

      {record && (step !== "summary" || !summaryIsSaved) && step !== "chat" && (
        <SavedReportPanel saved={record} mode="existing" showOpen onOpened={onOpened} onGone={onGone} />
      )}

      {step === "notice" && <PrivacyNotice onStart={() => goTo("chat")} />}

      {step === "chat" && (
        <InterviewChat
          messages={messages}
          streaming={streaming}
          status={status}
          errorKey={errorKey}
          ready={ready}
          generating={generating}
          generateError={generateError}
          onSend={(text) => {
            setFlash(null);
            void runChat(appendUserMessage(messages, text));
          }}
          onStop={stop}
          onRetry={retry}
          onGenerate={() => void generate()}
          onStartOver={startOver}
        />
      )}

      {step === "summary" && summary && (
        // lg: the summary (~70ch) on the left; save / delete and the actions in a sticky column on the right.
        <section
          aria-labelledby="summary-h"
          className="space-y-4 lg:grid lg:grid-cols-[minmax(0,70ch)_minmax(18rem,1fr)] lg:items-start lg:gap-x-10 lg:gap-y-4 lg:space-y-0"
          data-testid="report-summary"
        >
          <h2 id="summary-h" className="text-lg font-semibold lg:col-span-2">
            {summaryIsSaved ? t("summary.savedCopy", { date: formatDate(summaryExpires, locale) }) : t("summary.title")}
          </h2>
          <div className="lg:col-start-1">
            <SummaryPreview summary={summary} />
          </div>
          <div className="space-y-4 lg:sticky lg:top-36 lg:col-start-2 lg:row-start-2">
            {summaryIsSaved && record ? (
              <SavedReportPanel saved={record} mode={savedMode} showOpen={false} onOpened={onOpened} onGone={onGone} />
            ) : summaryIsSaved ? null : (
              <SaveReport
                key={summary.markdown}
                summary={summary}
                lang={lang}
                previous={record}
                onSaved={onSaved}
                onPreviousGone={() => {
                  setSaved(null);
                  setNoStorageRecord(null);
                }}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => goTo("chat")}
                  className="inline-flex h-11 items-center gap-1.5 rounded-md border bg-background px-4 text-sm font-medium"
                  data-testid="report-back-to-chat"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  {t("summary.backToChat")}
                </button>
              )}
              <ConfirmButton
                label={t("summary.newReport")}
                question={t("chat.confirmStartOver")}
                confirmLabel={t("chat.startOver")}
                onConfirm={startOver}
                testId="report-new"
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
