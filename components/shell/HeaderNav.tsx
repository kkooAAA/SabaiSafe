"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, RIBBON_BG, isActive } from "./nav-items";

const FEATURES = NAV_ITEMS.filter((n) => n.key !== "home");

/** md+ only: the feature links move from the bottom tab bar into the ink header (Home is the wordmark). */
export function HeaderNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="hidden min-w-0 flex-1 md:block">
      <ul className="flex items-center gap-1 lg:gap-2">
        {FEATURES.map(({ key, href, ribbon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex min-h-11 items-center rounded-md px-3 text-base leading-none whitespace-nowrap active:bg-white/10",
                  active ? "font-bold text-white" : "text-white/85",
                )}
              >
                {t(key)}
                {/* The feature's ribbon as a 3px underline; bold white text carries the same meaning. */}
                <span
                  aria-hidden
                  className={cn("absolute inset-x-3 bottom-1 h-[3px] rounded-full", active ? RIBBON_BG[ribbon] : "bg-transparent")}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
