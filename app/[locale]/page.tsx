import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Link } from "@/i18n/navigation";
import { NAV_ITEMS } from "@/components/shell/nav-items";

const TILES = NAV_ITEMS.filter((i) => i.key !== "home");

export default function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("home");
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </section>
      <ul className="grid gap-3">
        {TILES.map(({ key, href, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="flex min-h-20 items-center gap-4 rounded-xl border bg-card p-4 shadow-xs active:bg-accent"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t(`tiles.${key}.title`)}</span>
                <span className="block text-sm text-muted-foreground">{t(`tiles.${key}.desc`)}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}
