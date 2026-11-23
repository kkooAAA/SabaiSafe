import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RIBBON_TITLE } from "@/components/shell/nav-items";
import { findPrices } from "@/lib/db/prices";
import type { PriceRef } from "@/types/api";
import { PriceExplorer } from "@/components/price/PriceExplorer";

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "price" });
  return { title: t("title") };
}

/** Never throws: a DB failure renders an "unavailable" notice instead of error.tsx. */
async function loadPrices(): Promise<PriceRef[] | null> {
  try {
    return await findPrices({});
  } catch (err) {
    console.error("[price] findPrices failed", err);
    return null;
  }
}

export default async function PricePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("price");
  const tc = await getTranslations("common");
  const rows = await loadPrices();

  return (
    <div className="space-y-5">
      <section>
        <h1 className={`text-title font-bold ${RIBBON_TITLE.price}`}>{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </section>
      {rows === null ? (
        <p role="status" className="rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground">
          {tc("unavailable")}
        </p>
      ) : (
        <>
          {rows.some((r) => r.is_sample) && <p className="text-xs text-muted-foreground">{t("sampleNotice")}</p>}
          <PriceExplorer rows={rows} />
        </>
      )}
      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}
