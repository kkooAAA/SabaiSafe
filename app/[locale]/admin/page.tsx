import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminConsole } from "@/components/admin/AdminConsole";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

// Behind HTTP Basic auth in middleware (contracts §3.9); not indexed. The HTML holds no data: rows are
// fetched client-side from /api/admin/* (no-store).

export default async function AdminPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </section>
      <AdminConsole />
    </div>
  );
}
