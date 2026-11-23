import { FileText, House, LifeBuoy, Scale, Tag, type LucideIcon } from "lucide-react";

export type NavKey = "home" | "legal" | "report" | "price" | "help";
/** Each feature's longtail ribbon colour (tokens in app/globals.css). Home uses ink. */
export type Ribbon = "ink" | "legal" | "report" | "price" | "help";

export const NAV_ITEMS: readonly { key: NavKey; href: string; icon: LucideIcon; ribbon: Ribbon }[] = [
  { key: "home", href: "/", icon: House, ribbon: "ink" },
  { key: "legal", href: "/legal", icon: Scale, ribbon: "legal" },
  { key: "report", href: "/report", icon: FileText, ribbon: "report" },
  { key: "price", href: "/price", icon: Tag, ribbon: "price" },
  { key: "help", href: "/help", icon: LifeBuoy, ribbon: "help" },
];

/** Literal class names (so Tailwind sees them) for a ribbon used as a fill: stripes, bars, nav indicator. */
export const RIBBON_BG: Record<Ribbon, string> = {
  ink: "bg-ink",
  legal: "bg-ribbon-legal",
  report: "bg-ribbon-report",
  price: "bg-ribbon-price",
  help: "bg-ribbon-help",
};

/** Left accent stripe for a feature page h1; hangs in the page gutter so the text stays aligned. */
export const RIBBON_TITLE: Record<Ribbon, string> = {
  ink: "-ml-4 border-l-4 border-ink pl-3",
  legal: "-ml-4 border-l-4 border-ribbon-legal pl-3",
  report: "-ml-4 border-l-4 border-ribbon-report pl-3",
  price: "-ml-4 border-l-4 border-ribbon-price pl-3",
  help: "-ml-4 border-l-4 border-ribbon-help pl-3",
};

export function ribbonOf(key: NavKey): Ribbon {
  return NAV_ITEMS.find((n) => n.key === key)?.ribbon ?? "ink";
}

/** pathname is locale-less (from next-intl's usePathname). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
