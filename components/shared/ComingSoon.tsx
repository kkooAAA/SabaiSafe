import { useTranslations } from "next-intl";

export function ComingSoon({ title }: { title: string }) {
  const t = useTranslations("common");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("comingSoon")}</p>
    </div>
  );
}
