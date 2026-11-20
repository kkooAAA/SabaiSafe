import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type Kind = "sample" | "verified" | "unverified" | "sponsored" | "draft";

const STYLES: Record<Kind, string> = {
  sample: "border-warning-foreground/30 bg-warning text-warning-foreground",
  verified: "border-transparent bg-success text-success-foreground",
  unverified: "border-border bg-muted text-muted-foreground",
  sponsored: "border-primary/40 bg-accent text-primary",
  draft: "border-warning-foreground/30 bg-warning text-warning-foreground",
};

/**
 * Small status label. Text comes from messages common.<kind>.
 * Plain span (not ui/badge): ui/badge imports the `radix-ui` barrel, which pulls ~80 kB of Radix into
 * every client chunk that renders a badge.
 */
export function StatusBadge({ kind, className }: { kind: Kind; className?: string }) {
  const t = useTranslations("common");
  return (
    <span
      data-kind={kind}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[kind],
        className,
      )}
    >
      {t(kind)}
    </span>
  );
}
