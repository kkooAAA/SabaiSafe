"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, RIBBON_BG, isActive } from "./nav-items";

export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {NAV_ITEMS.map(({ key, href, icon: Icon, ribbon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 pt-1.5 text-xs leading-tight focus-visible:-outline-offset-4",
                  active ? "font-bold text-foreground" : "text-muted-foreground",
                )}
              >
                {/* The feature's ribbon marks where you are; weight + ink colour carry the same meaning. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 left-1/2 h-1 w-8 -translate-x-1/2 rounded-b-full",
                    active ? RIBBON_BG[ribbon] : "bg-transparent",
                  )}
                />
                <Icon className="size-5" strokeWidth={active ? 2.5 : 2} aria-hidden />
                <span className="w-full truncate text-center">{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
