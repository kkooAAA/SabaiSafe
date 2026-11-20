import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { EmergencyStrip } from "./EmergencyStrip";
import { LocaleSwitch } from "./LocaleSwitch";

export function Header() {
  const t = useTranslations("app");
  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 py-2">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-bold text-primary">
          <ShieldCheck className="size-6" aria-hidden />
          <span className="text-lg">{t("name")}</span>
        </Link>
        <LocaleSwitch />
      </div>
      <EmergencyStrip />
    </header>
  );
}
