import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { telHref } from "./format";

type Props = {
  number: string;
  label: string;
  className?: string;
  /** "strip": compact white-on-red pill (white on red darkened 15% = 6.5:1); "card": large row for the Help page. */
  variant?: "strip" | "card";
};

export function HotlineLink({ number, label, className, variant = "strip" }: Props) {
  if (variant === "card") {
    return (
      <a
        href={telHref(number)}
        className={cn(
          "flex min-h-14 items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs active:bg-accent",
          className,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emergency text-emergency-foreground">
          <Phone className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{label}</span>
        <span className="shrink-0 text-xl font-bold tabular-nums text-emergency">{number}</span>
      </a>
    );
  }
  return (
    <a
      href={telHref(number)}
      aria-label={`${label} ${number}`}
      className={cn(
        "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-md bg-black/15 px-1 py-1 leading-tight active:bg-black/30",
        className,
      )}
    >
      <span className="text-base font-bold tabular-nums">{number}</span>
      <span className="w-full truncate text-center text-xs">{label}</span>
    </a>
  );
}
