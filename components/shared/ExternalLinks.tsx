import { ExternalLink, MapPin, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { safeUrl, telHref } from "./format";

const linkCls =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-medium active:bg-accent";

/** Call / Map / Website / Source buttons; each only shows when its value is present and safe. */
export function ExternalLinks({
  phone,
  mapUrl,
  website,
  sourceUrl,
}: {
  phone?: string | null;
  mapUrl?: string | null;
  website?: string | null;
  sourceUrl?: string | null;
}) {
  const t = useTranslations("common");
  const map = safeUrl(mapUrl);
  const web = safeUrl(website);
  const src = safeUrl(sourceUrl);
  if (!phone && !map && !web && !src) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {phone && (
        <a href={telHref(phone)} className={`${linkCls} border-primary text-primary`}>
          <Phone className="size-4" aria-hidden />
          <span className="tabular-nums">{phone}</span>
        </a>
      )}
      {map && (
        <a href={map} target="_blank" rel="noopener noreferrer" className={linkCls}>
          <MapPin className="size-4" aria-hidden />
          {t("map")}
        </a>
      )}
      {web && (
        <a href={web} target="_blank" rel="noopener noreferrer" className={linkCls}>
          <ExternalLink className="size-4" aria-hidden />
          {t("website")}
        </a>
      )}
      {src && (
        <a href={src} target="_blank" rel="noopener noreferrer" className={linkCls}>
          <ExternalLink className="size-4" aria-hidden />
          {t("source")}
        </a>
      )}
    </div>
  );
}
