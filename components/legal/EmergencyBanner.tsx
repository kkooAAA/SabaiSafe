import { useLocale, useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { HOTLINES, type HotlineKey } from "@/lib/hotlines";
import { HotlineLink } from "@/components/shared/HotlineLink";
import { pickLang } from "@/components/shared/format";

const KEYS: readonly HotlineKey[] = ["tourist_police", "police", "ambulance"];

/** Shown above the answer when the question looks urgent: 1155 / 191 / 1669 from lib/hotlines.ts only. */
export function EmergencyBanner() {
  const locale = useLocale();
  const t = useTranslations("legal");
  const lines = HOTLINES.filter((h) => KEYS.includes(h.key));
  return (
    <section
      role="alert"
      data-testid="emergency-banner"
      className="space-y-2 rounded-xl border-2 border-emergency bg-emergency/5 p-3"
    >
      <h2 className="flex items-center gap-2 font-semibold text-emergency">
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
        {t("emergencyTitle")}
      </h2>
      <p className="text-sm">{t("emergencyText")}</p>
      <ul className="grid gap-2">
        {lines.map((h) => (
          <li key={h.key}>
            <HotlineLink variant="card" number={h.number} label={pickLang(locale, h.name_en, h.name_zh)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
