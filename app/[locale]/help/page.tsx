import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getHelp } from "@/lib/db/help";
import type { HelpResponse } from "@/types/api";
import { HotlineList } from "@/components/help/HotlineList";
import { ContactDirectory } from "@/components/help/ContactDirectory";
import { BusinessCard } from "@/components/help/BusinessCard";
import { mergeContacts } from "@/components/help/merge-contacts";

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "help" });
  return { title: t("title") };
}

/** Never throws: a DB failure still renders the four hotlines from lib/hotlines.ts. */
async function loadHelp(): Promise<HelpResponse | null> {
  try {
    return await getHelp({});
  } catch (err) {
    console.error("[help] getHelp failed", err);
    return null;
  }
}

export default async function HelpPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("help");
  const tc = await getTranslations("common");
  const data = await loadHelp();
  const { hotlines, contacts, categories } = mergeContacts(data?.contacts);
  const businesses = data?.businesses ?? []; // server order (by name); sponsorship never reorders
  const hasSample = contacts.some((c) => c.is_sample) || businesses.some((b) => b.is_sample);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </section>

      <HotlineList hotlines={hotlines} />

      {data === null ? (
        <p role="status" className="rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground">
          {tc("unavailable")}
        </p>
      ) : (
        <>
          {hasSample && <p className="text-xs text-muted-foreground">{t("sampleNotice")}</p>}
          <ContactDirectory contacts={contacts} categories={categories} />
          <section aria-labelledby="biz-h" className="space-y-3">
            <h2 id="biz-h" className="text-lg font-semibold">
              {t("businessesTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("businessesNote")}</p>
            {businesses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noBusinesses")}</p>
            ) : (
              <ul className="grid gap-3">
                {businesses.map((b) => (
                  <li key={b.id}>
                    <BusinessCard business={b} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
