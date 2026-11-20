import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Two-step inline confirmation (no window.confirm, which blocks and looks out of place on mobile). */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled,
  danger,
  className,
  testId,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("report");
  const [asking, setAsking] = useState(false);
  const base = "inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium disabled:opacity-50";
  if (!asking) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
        data-testid={testId}
        className={cn(base, "bg-background", danger && "border-destructive/50 text-destructive", className)}
      >
        {label}
      </button>
    );
  }
  return (
    <div role="group" aria-label={question} className="w-full space-y-2 rounded-lg border p-3">
      <p className="text-sm">{question}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
          data-testid={testId ? `${testId}-yes` : undefined}
          className={cn(base, danger ? "border-transparent bg-destructive text-white" : "bg-primary text-primary-foreground")}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={() => setAsking(false)} className={cn(base, "bg-background")}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
