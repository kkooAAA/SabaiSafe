import { FileText, House, LifeBuoy, Scale, Tag, type LucideIcon } from "lucide-react";

export type NavKey = "home" | "legal" | "report" | "price" | "help";

export const NAV_ITEMS: readonly { key: NavKey; href: string; icon: LucideIcon }[] = [
  { key: "home", href: "/", icon: House },
  { key: "legal", href: "/legal", icon: Scale },
  { key: "report", href: "/report", icon: FileText },
  { key: "price", href: "/price", icon: Tag },
  { key: "help", href: "/help", icon: LifeBuoy },
];

/** pathname is locale-less (from next-intl's usePathname). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
