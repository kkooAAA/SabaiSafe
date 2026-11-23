import { ChevronRight, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Link } from "@/i18n/navigation";
import { HOTLINES } from "@/lib/hotlines";
import { NAV_ITEMS, RIBBON_BG, type NavKey } from "@/components/shell/nav-items";
import { telHref } from "@/components/shared/format";

/** Ordered by how often a stressed tourist needs each one. */
const ORDER: readonly NavKey[] = ["price", "legal", "report", "help"];
const TILES = ORDER.flatMap((k) => NAV_ITEMS.filter((i) => i.key === k));
const TOURIST_POLICE = HOTLINES.find((h) => h.key === "tourist_police")!;

export default function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("home");
  const te = useTranslations("emergency");
  return (
    <div className="space-y-6">
      <h1 className="pt-2 text-title font-bold">{t("title")}</h1>

      <ul className="-mx-4 divide-y border-y bg-card sm:mx-0 sm:overflow-hidden sm:rounded-lg sm:border">
        {TILES.map(({ key, href, ribbon }, i) => (
          <li key={key}>
            <Link
              href={href}
              className="relative flex min-h-16 items-center gap-3 py-3.5 pr-4 pl-5 focus-visible:-outline-offset-4 active:bg-accent"
            >
              <span
                aria-hidden
                style={{ animationDelay: `${i * 70}ms` }}
                className={`absolute inset-y-0 left-0 w-1 origin-top motion-safe:animate-ribbon-in ${RIBBON_BG[ribbon]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-row font-bold">{t(`tiles.${key}.title`)}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{t(`tiles.${key}.desc`)}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="tp-label" className="rounded-lg border-2 border-ink bg-card px-3.5 py-4">
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

      <p className="text-sm text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}
