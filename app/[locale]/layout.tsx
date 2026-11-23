import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Header } from "@/components/shell/Header";
import { BottomNav } from "@/components/shell/BottomNav";
import { CONTAINER } from "@/components/shell/container";
import { fontVariables } from "./fonts";
import "../globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e2a33" };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "app" });
  return { title: { default: t("name"), template: `%s · ${t("name")}` }, description: t("tagline") };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} className={fontVariables}>
      <body className="min-h-dvh font-sans">
        <NextIntlClientProvider>
          <Header />
          <main id="main" tabIndex={-1} className={`${CONTAINER} pb-24 pt-4 focus:outline-none md:pb-12 md:pt-6 lg:pt-8`}>{children}</main>
          <BottomNav />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
