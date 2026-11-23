import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RIBBON_TITLE } from "@/components/shell/nav-items";
import { ReportAssistant } from "@/components/report/ReportAssistant";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "report" });
  return { title: t("title") };
}

export default async function ReportPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");
  return (
    <div className="space-y-5">
      <section>
        <h1 className={`text-title font-bold ${RIBBON_TITLE.report}`}>{t("title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t("intro")}</p>
      </section>
      <ReportAssistant />
    </div>
  );
}
