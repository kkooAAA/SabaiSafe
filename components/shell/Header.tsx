import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { EmergencyStrip } from "./EmergencyStrip";
import { LocaleSwitch } from "./LocaleSwitch";
import { NAV_ITEMS, RIBBON_BG } from "./nav-items";

const FEATURE_RIBBONS = NAV_ITEMS.filter((n) => n.key !== "home").map((n) => n.ribbon);

export function Header() {
  const t = useTranslations("app");
  return (
    // --ring is overridden to marigold on the ink bar so keyboard focus stays visible (6.7:1 on ink).
    <header className="sticky top-0 z-40 bg-ink text-white [--ring:var(--ribbon-price)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-md focus:bg-ribbon-price focus:px-4 focus:text-sm focus:font-bold focus:text-ribbon-price-foreground"
      >
        {t("skipToContent")}
      </a>
      <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 py-2">
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-md text-xl font-bold leading-none">
          {/* The four ribbons tied to the bow: one per feature. */}
          <span aria-hidden className="flex h-6 items-stretch gap-[3px]">
            {FEATURE_RIBBONS.map((r) => (
              <span key={r} className={`w-[5px] rounded-full ${RIBBON_BG[r]}`} />
            ))}
          </span>
          <span>{t("name")}</span>
        </Link>
        <LocaleSwitch />
      </div>
      <EmergencyStrip />
    </header>
  );
}
