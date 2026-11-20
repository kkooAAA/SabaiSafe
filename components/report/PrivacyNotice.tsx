import { useTranslations } from "next-intl";
import { Bot, FileWarning, IdCard, Lock } from "lucide-react";

export function PrivacyNotice({ onStart }: { onStart: () => void }) {
  const t = useTranslations("report.notice");
  const items = [
    { key: "aiProvider", Icon: Bot },
    { key: "notStored", Icon: Lock },
    { key: "noPassport", Icon: IdCard },
    { key: "notFiling", Icon: FileWarning },
  ] as const;
  return (
    <section aria-labelledby="notice-h" className="space-y-4 rounded-xl border bg-card p-4" data-testid="report-notice">
      <h2 id="notice-h" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <ul className="space-y-3">
        {items.map(({ key, Icon }) => (
          <li key={key} className="flex gap-3 text-sm leading-snug">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span className={key === "noPassport" ? "font-semibold" : undefined}>{t(key)}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
      >
        {t("start")}
      </button>
    </section>
  );
}
