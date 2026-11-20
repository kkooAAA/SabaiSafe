import { useId } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { FIELDS, type Entity, type FieldErrors, type FieldSpec, type FormValues } from "./admin-form";

const inputCls =
  "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-base shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[invalid=true]:border-destructive";

type Props = {
  entity: Entity;
  values: FormValues;
  errors: FieldErrors;
  /** Server messages are shown as given; client errors are message keys under admin.errors. */
  serverErrors: FieldErrors;
  onChange: (name: string, value: FormValues[string]) => void;
};

export function AdminForm({ entity, values, errors, serverErrors, onChange }: Props) {
  const t = useTranslations("admin");
  const tAll = useTranslations();
  const uid = useId();

  function field(f: FieldSpec) {
    const id = `${uid}-${f.name}`;
    const errId = `${id}-err`;
    const err = errors[f.name] ? t(`errors.${errors[f.name]}`) : serverErrors[f.name];
    const label = (
      <>
        {t(`field.${f.name}`)}
        {f.required && (
          <span className="text-destructive" aria-hidden>
            {" "}*
          </span>
        )}
      </>
    );
    const common = {
      id,
      "aria-invalid": err ? true : undefined,
      "aria-describedby": err ? errId : undefined,
      "aria-required": f.required || undefined,
    } as const;
    const v = values[f.name];
    let control: React.ReactNode;

    if (f.kind === "checkbox") {
      return (
        <div key={f.name} className="grid gap-1">
          <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" {...common} checked={v === true} onChange={(e) => onChange(f.name, e.target.checked)} className="size-5 shrink-0 accent-primary" />
            <span>{label}</span>
          </label>
          {err && <p id={errId} className="text-sm text-destructive">{err}</p>}
        </div>
      );
    }
    if (f.kind === "checkboxes") {
      const set = new Set(Array.isArray(v) ? v : []);
      return (
        <fieldset key={f.name} className="grid gap-1" aria-describedby={err ? errId : undefined}>
          <legend className="mb-1 text-sm font-medium">{label}</legend>
          {(f.options ?? []).map((o) => (
            <label key={o} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={set.has(o)}
                onChange={(e) => {
                  const next = new Set(set);
                  if (e.target.checked) next.add(o);
                  else next.delete(o);
                  onChange(f.name, (f.options ?? []).filter((x) => next.has(x)));
                }}
                className="size-5 shrink-0 accent-primary"
              />
              <span>{tAll(`${f.optionNs}.${o}`)}</span>
            </label>
          ))}
          {err && <p id={errId} className="text-sm text-destructive">{err}</p>}
        </fieldset>
      );
    }
    const s = typeof v === "string" ? v : "";
    if (f.kind === "select") {
      control = (
        <select {...common} value={s} onChange={(e) => onChange(f.name, e.target.value)} className={cn(inputCls, "min-h-11")}>
          {/* A stored value outside the list (old data) stays selectable, so editing other fields doesn't change it. */}
          {s && !(f.options ?? []).includes(s) && <option value={s}>{s}</option>}
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {f.optionNs ? tAll(`${f.optionNs}.${o}`) : o}
            </option>
          ))}
        </select>
      );
    } else if (f.kind === "textarea") {
      control = <textarea {...common} rows={2} value={s} onChange={(e) => onChange(f.name, e.target.value)} className={cn(inputCls, "resize-y")} />;
    } else {
      control = (
        <input
          {...common}
          type={f.kind === "date" ? "date" : f.kind === "url" ? "url" : "text"}
          inputMode={f.kind === "number" ? "decimal" : undefined}
          autoComplete="off"
          value={s}
          onChange={(e) => onChange(f.name, e.target.value)}
          className={cn(inputCls, "min-h-11")}
        />
      );
    }
    return (
      <div key={f.name} className="grid gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {control}
        {err && (
          <p id={errId} className="text-sm text-destructive">
            {err}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {FIELDS[entity].map(field)}
    </div>
  );
}
