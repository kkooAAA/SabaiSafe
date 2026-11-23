import { ChevronRight, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Link } from "@/i18n/navigation";
import { HOTLINES } from "@/lib/hotlines";
import { NAV_ITEMS, RIBBON_BG, type NavKey } from "@/components/shell/nav-items";
import { pickLang, telHref } from "@/components/shared/format";

/** Ordered by how often a stressed tourist needs each one. */
const ORDER: readonly NavKey[] = ["price", "legal", "report", "help"];
const TILES = ORDER.flatMap((k) => NAV_ITEMS.filter((i) => i.key === k));
const TOURIST_POLICE = HOTLINES.find((h) => h.key === "tourist_police")!;
const OTHER_HOTLINES = HOTLINES.filter((h) => h.key !== "tourist_police");

/*
 * Phone (<768): one column of flat ribbon rows, then the Tourist Police block.
 * md: the rows become a 2x2 grid of ribbon tiles; Tourist Police block full width below.
 * lg: tiles on the left (2/3), a sticky aside on the right with Tourist Police + the other hotlines.
 */
export default function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("home");
  const te = useTranslations("emergency");
  return (
    <div className="space-y-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-8 lg:space-y-0">
      <div className="space-y-6 lg:col-span-2">
        <h1 className="pt-2 text-title font-bold md:pt-0">{t("title")}</h1>

        <ul className="-mx-4 divide-y border-y bg-card sm:mx-0 sm:overflow-hidden sm:rounded-lg sm:border md:grid md:grid-cols-2 md:gap-4 md:divide-y-0 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent">
          {TILES.map(({ key, href, ribbon }, i) => (
            <li key={key} className="md:overflow-hidden md:rounded-lg md:border md:bg-card">
              <Link
                href={href}
                className="relative flex min-h-16 items-center gap-3 py-3.5 pr-4 pl-5 focus-visible:-outline-offset-4 active:bg-accent md:h-full md:min-h-32 md:items-start md:py-5 md:pr-5 md:pl-7"
              >
                <span
                  aria-hidden
                  style={{ animationDelay: `${i * 70}ms` }}
                  className={`absolute inset-y-0 left-0 w-1 origin-top motion-safe:animate-ribbon-in md:w-1.5 ${RIBBON_BG[ribbon]}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-row font-bold md:text-xl">{t(`tiles.${key}.title`)}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground md:mt-1.5 md:text-base">{t(`tiles.${key}.desc`)}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground md:mt-1" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>

        <p className="hidden max-w-prose text-sm text-muted-foreground lg:block">{t("disclaimer")}</p>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-36 lg:space-y-4">
        <section aria-labelledby="tp-label" className="rounded-lg border-2 border-ink bg-card px-3.5 py-4 md:px-5 md:py-5">
          <h2 id="tp-label" className="text-base font-bold">
            {te("short.tourist_police")}
          </h2>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <p className="text-display font-extrabold tabular-nums">{TOURIST_POLICE.number}</p>
            <a
              href={telHref(TOURIST_POLICE.number)}
              className="inline-flex min-h-12 items-center gap-2 rounded-md bg-emergency px-4 text-base font-bold text-emergency-foreground active:bg-emergency/85"
            >
              <Phone className="size-5" aria-hidden />
              {t("call", { number: TOURIST_POLICE.number })}
            </a>
          </div>
        </section>

        {/* Desktop only: the other hotlines as plain rows under the Tourist Police block. */}
        <ul aria-label={te("label")} className="hidden divide-y rounded-lg border bg-card lg:block">
          {OTHER_HOTLINES.map((h) => (
            <li key={h.key}>
              <a
                href={telHref(h.number)}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 focus-visible:-outline-offset-4 active:bg-accent"
              >
                <span className="min-w-0 text-sm font-medium leading-snug">{pickLang(locale, h.name_en, h.name_zh)}</span>
                <span className="shrink-0 text-2xl font-bold tabular-nums">{h.number}</span>
              </a>
            </li>
          ))}
        </ul>

        <p className="text-sm text-muted-foreground lg:hidden">{t("disclaimer")}</p>
      </aside>
    </div>
  );
}
