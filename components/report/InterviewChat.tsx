import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Send, Square } from "lucide-react";
import { MAX_MESSAGE_CHARS } from "@/types/protocol";
import { cn } from "@/lib/utils";
import { ConfirmButton } from "@/components/shared/ConfirmButton";
import { checkNextMessage, isAtLimit, type LimitProblem, type Msg } from "./report-state";

export type ChatStatus = "idle" | "loading" | "error" | "stopped";

type Props = {
  messages: Msg[];
  streaming: string | null;
  status: ChatStatus;
  errorKey: string | null;
  ready: boolean;
  generating: boolean;
  generateError: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: (() => void) | null;
  onGenerate: () => void;
  onStartOver: () => void;
};

function Bubble({ role, children, label }: { role: Msg["role"]; children: React.ReactNode; label: string }) {
  const mine = role === "user";
  return (
    <li className={cn("flex", mine ? "justify-end" : "justify-start")} data-role={role}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]",
          mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card",
        )}
      >
        <span className="sr-only">{label}: </span>
        {children}
      </div>
    </li>
  );
}

export function InterviewChat(p: Props) {
  const t = useTranslations("report.chat");
  const tl = useTranslations("report.limits");
  const te = useTranslations("report.errors");
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<LimitProblem | null>(null);
  const endRef = useRef<HTMLLIElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const loading = p.status === "loading";
  const atLimit = isAtLimit(p.messages);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [p.messages.length, p.streaming, p.status]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const why = checkNextMessage(p.messages, draft);
    setProblem(why);
    if (why) return;
    p.onSend(draft.trim());
    setDraft("");
  }

  return (
    <section aria-labelledby="chat-h" className="space-y-3" data-testid="report-chat">
      <h2 id="chat-h" className="sr-only">
        {t("title")}
      </h2>
      <ol className="space-y-2" aria-live="polite" aria-busy={loading || undefined}>
        <Bubble role="assistant" label={t("assistant")}>
          {t("greeting")}
        </Bubble>
        {p.messages.map((m, i) => (
          <Bubble key={i} role={m.role} label={m.role === "user" ? t("you") : t("assistant")}>
            {m.content}
          </Bubble>
        ))}
        {loading && (
          <Bubble role="assistant" label={t("assistant")}>
            {p.streaming ? (
              p.streaming
            ) : (
              <span role="status" className="text-muted-foreground">
                {t("thinking")}
              </span>
            )}
          </Bubble>
        )}
        <li ref={endRef} aria-hidden className="h-0" />
      </ol>

      {p.status === "stopped" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("stopped")}
        </p>
      )}
      {p.status === "error" && p.errorKey && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3" data-testid="report-chat-error">
          <p className="text-sm text-destructive">{te(p.errorKey)}</p>
        </div>
      )}
      {(p.status === "error" || p.status === "stopped") && p.onRetry && (
        <button
          type="button"
          onClick={p.onRetry}
          className="h-11 rounded-md border bg-background px-4 text-sm font-medium"
          data-testid="report-retry"
        >
          {t("retry")}
        </button>
      )}

      {atLimit && !loading ? (
        <p role="status" className="rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground" data-testid="report-limit">
          {tl("too_long")}
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-2">
          <label htmlFor="report-msg" className="sr-only">
            {t("label")}
          </label>
          <textarea
            id="report-msg"
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            onChange={(e) => {
              setDraft(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={t("placeholder")}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "report-msg-err" : "report-msg-count"}
            className="w-full min-w-0 resize-y rounded-md border bg-background px-3 py-2 text-base shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          <div className="flex items-center gap-2">
            <span id="report-msg-count" className="mr-auto text-xs text-muted-foreground tabular-nums">
              {draft.length}/{MAX_MESSAGE_CHARS}
            </span>
            {loading && (
              <button
                type="button"
                onClick={p.onStop}
                className="inline-flex h-11 items-center gap-1.5 rounded-md border bg-background px-4 text-sm font-medium"
              >
                <Square className="size-3.5" aria-hidden />
                {t("stop")}
              </button>
            )}
            <button
              type="submit"
              disabled={loading || p.generating}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden />
              {loading ? t("sending") : t("send")}
            </button>
          </div>
          {problem && (
            <p id="report-msg-err" role="alert" className="text-sm text-destructive">
              {tl(problem, { max: MAX_MESSAGE_CHARS })}
            </p>
          )}
        </form>
      )}

      <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
        <p className="text-sm text-muted-foreground" role="status">
          {p.ready ? t("readyHint") : t("notReadyHint")}
        </p>
        <button
          type="button"
          onClick={p.onGenerate}
          disabled={!p.ready || loading || p.generating}
          data-ready={p.ready ? "true" : "false"}
          data-testid="report-create-summary"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <FileText className="size-4" aria-hidden />
          {p.generating ? t("creating") : t("createSummary")}
        </button>
        {p.generateError && (
          <div role="alert" className="space-y-2" data-testid="report-generate-error">
            <p className="text-sm text-destructive">{te(p.generateError)}</p>
            {p.generateError !== "too_long_or_invalid" && (
              <button
                type="button"
                onClick={p.onGenerate}
                disabled={loading || p.generating}
                className="h-11 rounded-md border bg-background px-4 text-sm font-medium disabled:opacity-50"
                data-testid="report-generate-retry"
              >
                {t("retry")}
              </button>
            )}
          </div>
        )}
        {(p.messages.length > 0 || p.status !== "idle") && (
          <ConfirmButton
            label={t("startOver")}
            question={t("confirmStartOver")}
            confirmLabel={t("startOver")}
            onConfirm={p.onStartOver}
            disabled={p.generating}
            className="w-full"
            testId="report-start-over"
          />
        )}
      </div>
    </section>
  );
}
