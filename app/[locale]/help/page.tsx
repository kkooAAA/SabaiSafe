import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RIBBON_TITLE } from "@/components/shell/nav-items";
import { getHelp } from "@/lib/db/help";
import type { HelpResponse } from "@/types/api";
import { HotlineList } from "@/components/help/HotlineList";
import { ContactDirectory } from "@/components/help/ContactDirectory";
import { BusinessDirectory } from "@/components/help/BusinessDirectory";
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
        <h1 className={`text-title font-bold ${RIBBON_TITLE.help}`}>{t("title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t("intro")}</p>
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
          <BusinessDirectory businesses={businesses} />
        </>
      )}
    </div>
  );
}
