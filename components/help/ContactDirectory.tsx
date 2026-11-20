"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { HelpCategory, HelpContact } from "@/types/api";
import { cn } from "@/lib/utils";
import { ContactCard } from "./ContactCard";
import { filterByCategory } from "./merge-contacts";

export function ContactDirectory({
  contacts,
  categories,
}: {
  contacts: HelpContact[];
  categories: HelpCategory[];
}) {
  const t = useTranslations("help");
  const tc = useTranslations("common");
  const [category, setCategory] = useState<HelpCategory | null>(null);
  const shown = filterByCategory(contacts, category);
  const chips: (HelpCategory | null)[] = [null, ...categories];

  return (
    <section aria-labelledby="contacts-h" className="space-y-3">
      <h2 id="contacts-h" className="text-lg font-semibold">
        {t("contactsTitle")}
      </h2>
      {categories.length > 1 && (
        <div role="group" aria-label={t("filterLabel")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {chips.map((c) => {
            const active = c === category;
            return (
              <button
                key={c ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-background active:bg-accent",
                )}
              >
                {c ? t(`category.${c}`) : tc("all")}
              </button>
            );
          })}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noContacts")}</p>
      ) : (
        <ul className="grid gap-3">
          {shown.map((c) => (
            <li key={c.id}>
              <ContactCard contact={c} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
