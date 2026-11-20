"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Pencil, Plus, Search } from "lucide-react";
import type { Business, PriceRef } from "@/types/api";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatThbRange } from "@/components/shared/format";
import { ConfirmButton } from "@/components/shared/ConfirmButton";
import { cn } from "@/lib/utils";
import { AdminForm } from "./AdminForm";
import { createRow, deleteRow, listRows, updateRow, type AdminFail } from "./admin-api";
import {
  diffBody,
  emptyValues,
  FIELDS,
  fromFormValues,
  searchRows,
  toFormValues,
  type Entity,
  type FieldErrors,
  type FormValues,
} from "./admin-form";

type AnyRow = PriceRef | Business;
type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; row: AnyRow };
type Flash = "created" | "saved" | "deleted" | "deactivated" | "unchanged";

/** Message key under admin.errors for a failed admin request. */
export function adminErrorKey(f: Pick<AdminFail, "status" | "code">): string {
  if (f.status === 0) return "network";
  if (f.status === 401) return "unauthorized";
  if (f.status === 503) return "unavailable";
  if (f.status === 404) return "not_found";
  if (f.status === 409 || f.code === "conflict") return "conflict";
  if (f.status === 400) return "invalid";
  return "generic";
}

export function AdminConsole() {
  const t = useTranslations("admin");
  const tAll = useTranslations();
  const locale = useLocale();
  const [entity, setEntity] = useState<Entity>("prices");
  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [values, setValues] = useState<FormValues>(() => emptyValues("prices"));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ key: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (e: Entity) => {
    setRows(null);
    setLoadError(null);
    const r = await listRows(e);
    if (!r.ok) return setLoadError(adminErrorKey(r));
    setPersisted(r.persisted);
    setRows(r.rows);
  }, []);

  useEffect(() => {
    void load(entity);
  }, [entity, load]);

  const shown = useMemo(() => searchRows(rows ?? [], query), [rows, query]);

  function scrollTop() {
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function open(next: Mode) {
    setMode(next);
    setErrors({});
    setServerErrors({});
    setFormError(null);
    setFlash(null);
    setRowError(null);
    setValues(next.kind === "edit" ? toFormValues(entity, next.row) : emptyValues(entity));
    scrollTop();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind === "list") return;
    const parsed = fromFormValues(entity, values, mode.kind === "edit" ? (mode.row as unknown as Record<string, unknown>) : undefined);
    setServerErrors({});
    setFormError(null);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setFormError({ key: "formHasErrors", message: "" });
      return;
    }
    setErrors({});
    const body = parsed.body as unknown as Record<string, unknown>;
    const patch = mode.kind === "edit" ? diffBody(mode.row as unknown as Record<string, unknown>, body) : null;
    if (patch && Object.keys(patch).length === 0) {
      // Nothing changed: backend rejects an empty PATCH, so don't send one.
      setFlash("unchanged");
      setMode({ kind: "list" });
      scrollTop();
      return;
    }
    setSaving(true);
    const r =
      mode.kind === "create"
        ? await createRow(entity, parsed.body)
        : await updateRow(entity, mode.row.id, patch ?? {});
    setSaving(false);
    if (!r.ok) {
      setServerErrors(r.fields);
      setFormError({ key: Object.keys(r.fields).length ? "formHasErrors" : adminErrorKey(r), message: r.message });
      return;
    }
    setPersisted(r.persisted);
    setFlash(mode.kind === "create" ? "created" : "saved");
    setMode({ kind: "list" });
    scrollTop();
    void load(entity);
  }

  async function remove(row: AnyRow) {
    setRowError(null);
    setFlash(null);
    const r = await deleteRow(entity, row.id);
    if (!r.ok) return setRowError(adminErrorKey(r));
    setPersisted(r.persisted);
    setFlash(entity === "businesses" ? "deactivated" : "deleted");
    void load(entity);
  }

  const tabs: Entity[] = ["prices", "businesses"];

  return (
    <div ref={topRef} className="scroll-mt-28 space-y-4" data-testid="admin" data-entity={entity} data-mode={mode.kind}>
      {!persisted && (
        <p role="status" className="rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground" data-testid="admin-sample-mode">
          {t("sampleMode")}
        </p>
      )}

      {mode.kind === "list" ? (
        <>
          <div role="tablist" aria-label={t("tabsLabel")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {tabs.map((e) => (
              <button
                key={e}
                type="button"
                role="tab"
                aria-selected={entity === e}
                onClick={() => {
                  setEntity(e);
                  setQuery("");
                  setFlash(null);
                  setRowError(null);
                }}
                className={cn("min-h-11 rounded-md text-sm font-medium", entity === e ? "bg-background shadow-xs" : "text-muted-foreground")}
                data-testid={`admin-tab-${e}`}
              >
                {t(`tabs.${e}`)}
              </button>
            ))}
          </div>

          <div role="tabpanel" className="space-y-3">
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t("search")}</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("search")}
                  className="min-h-11 w-full rounded-md border bg-background py-2 pr-3 pl-9 text-base shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  data-testid="admin-search"
                />
              </label>
              <button
                type="button"
                onClick={() => open({ kind: "create" })}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                data-testid="admin-add"
              >
                <Plus className="size-4" aria-hidden />
                {t("add")}
              </button>
            </div>

            {flash && (
              <p role="status" className="rounded-lg border bg-success p-3 text-sm text-success-foreground" data-testid="admin-flash">
                {t(`flash.${flash}`)}
                {!persisted && flash !== "unchanged" && `${locale === "zh" ? "" : " "}${t("flashNotPersisted")}`}
              </p>
            )}
            {rowError && (
              <p role="alert" className="text-sm text-destructive" data-testid="admin-row-error">
                {t(`errors.${rowError}`)}
              </p>
            )}

            {loadError ? (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3" data-testid="admin-load-error">
                <p className="text-sm text-destructive">{t(`errors.${loadError}`)}</p>
                <button type="button" onClick={() => void load(entity)} className="h-11 rounded-md border bg-background px-4 text-sm font-medium">
                  {t("retry")}
                </button>
              </div>
            ) : rows === null ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("loading")}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {t("count", { count: shown.length, total: rows.length })}
                </p>
                {shown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("empty")}</p>
                ) : (
                  <ul className="grid gap-2" data-testid="admin-rows">
                    {shown.map((r) => (
                      <li key={r.id} className="space-y-2 rounded-lg border bg-card p-3" data-testid="admin-row" data-id={r.id}>
                        {"item_key" in r ? (
                          <div className="min-w-0 text-sm">
                            <p className="font-medium [overflow-wrap:anywhere]">{locale === "zh" ? r.item_name_zh : r.item_name_en}</p>
                            <p className="text-muted-foreground [overflow-wrap:anywhere]">
                              {r.area} · {formatThbRange(r.min_thb, r.max_thb, locale)} {tAll(`price.unit.${r.unit}`)}
                            </p>
                            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                              {r.item_key} · {r.source} · {r.collected_at}
                            </p>
                          </div>
                        ) : (
                          <div className="min-w-0 text-sm">
                            <p className="font-medium [overflow-wrap:anywhere]">{r.name}</p>
                            <p className="text-muted-foreground">
                              {tAll(`help.businessCategory.${r.category}`)} · {r.area}
                            </p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-1">
                          {r.is_sample && <StatusBadge kind="sample" />}
                          {"is_sponsored" in r && r.is_sponsored && <StatusBadge kind="sponsored" />}
                          {"is_active" in r && !r.is_active && (
                            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{t("inactive")}</span>
                          )}
                          {"is_fixed_by_law" in r && r.is_fixed_by_law && (
                            <span className="rounded-full border px-2 py-0.5 text-xs">{tAll("price.fixedByLaw")}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => open({ kind: "edit", row: r })}
                            className="inline-flex h-11 items-center gap-1.5 rounded-md border bg-background px-4 text-sm font-medium"
                            data-testid="admin-edit"
                          >
                            <Pencil className="size-4" aria-hidden />
                            {t("edit")}
                          </button>
                          {!("is_active" in r && !r.is_active) && (
                            <ConfirmButton
                              label={entity === "businesses" ? t("deactivate") : t("delete")}
                              question={entity === "businesses" ? t("confirmDeactivate") : t("confirmDelete")}
                              confirmLabel={entity === "businesses" ? t("deactivate") : t("delete")}
                              onConfirm={() => void remove(r)}
                              danger
                              testId="admin-delete"
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="admin-form">
          <button
            type="button"
            onClick={() => open({ kind: "list" })}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border bg-background px-4 text-sm font-medium"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("back")}
          </button>
          <h2 className="text-lg font-semibold">
            {t(mode.kind === "create" ? `createTitle.${entity}` : `editTitle.${entity}`)}
          </h2>
          <p className="text-xs text-muted-foreground">{t("requiredHint")}</p>
          <AdminForm
            entity={entity}
            values={values}
            errors={errors}
            serverErrors={serverErrors}
            onChange={(name, v) => {
              setValues((prev) => ({ ...prev, [name]: v }));
              setErrors((prev) => {
                if (!(name in prev)) return prev;
                const next = { ...prev };
                delete next[name];
                return next;
              });
            }}
          />
          {formError && (
            <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 p-3 text-sm text-destructive" data-testid="admin-form-error">
              <p>{t(`errors.${formError.key}`)}</p>
              {formError.message && formError.key !== "formHasErrors" && <p className="text-xs">{formError.message}</p>}
              {/* Server errors on keys that are not form fields (e.g. "body") would otherwise be invisible. */}
              {Object.entries(serverErrors)
                .filter(([k]) => !FIELDS[entity].some((f) => f.name === k))
                .map(([k, m]) => (
                  <p key={k} className="text-xs">
                    {k}: {m}
                  </p>
                ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              data-testid="admin-save"
            >
              {saving ? t("saving") : t("save")}
            </button>
            <button type="button" onClick={() => open({ kind: "list" })} className="h-11 rounded-md border bg-background px-4 text-sm font-medium">
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
