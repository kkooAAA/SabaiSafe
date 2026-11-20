import { useTranslations } from "next-intl";
import { HOTLINES, type HotlineKey } from "@/lib/hotlines";
import { HotlineLink } from "@/components/shared/HotlineLink";

const STRIP_KEYS: readonly HotlineKey[] = ["tourist_police", "police", "ambulance"];

/** Persistent strip on every page: 1155 / 191 / 1669 from lib/hotlines.ts (never hard-coded). */
export function EmergencyStrip() {
  const t = useTranslations("emergency");
  const lines = HOTLINES.filter((h) => STRIP_KEYS.includes(h.key));
  return (
    <nav aria-label={t("label")} className="bg-emergency text-emergency-foreground">
      <div className="mx-auto flex max-w-md items-center gap-1.5 px-2 py-1.5">
        <span className="shrink-0 px-1 text-xs font-semibold uppercase leading-tight">{t("title")}</span>
        {lines.map((h) => (
          <HotlineLink key={h.key} number={h.number} label={t(`short.${h.key}`)} />
        ))}
      </div>
    </nav>
  );
}
