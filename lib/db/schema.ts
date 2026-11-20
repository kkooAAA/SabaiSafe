// Validation for sample data and seed rows. Owner: backend. Mirrors the CHECK constraints in
// supabase/migrations/20261115000002_tables.sql and contracts v0.2 §2 / §5. Keep them in sync.
import { z } from "zod";
import { BUSINESS_CRITERIA, PRICE_UNITS } from "@/types/api";

export const PRICES_CSV_HEADER = [
  "item_key",
  "item_name_en",
  "item_name_zh",
  "category",
  "area",
  "min_thb",
  "max_thb",
  "unit",
  "is_fixed_by_law",
  "source",
  "source_url",
  "collected_at",
  "notes",
  "notes_zh",
  "is_sample",
] as const;

/** §5 fixed area list. "Phuket" = island-wide; such rows are included in every area search. */
export const AREAS = [
  "Phuket",
  "Phuket Airport",
  "Phuket Town",
  "Patong",
  "Kata",
  "Karon",
  "Kamala",
  "Rawai",
  "Chalong",
  "Bang Tao",
] as const;
export const ISLAND_WIDE_AREA = "Phuket";

export const PRICE_CATEGORIES = ["transport", "rental", "activity", "food", "accommodation", "other"] as const;
export const HELP_CATEGORIES = ["emergency", "police", "hospital", "embassy", "consumer", "immigration", "other"] as const;
export const BUSINESS_CATEGORIES = ["rental", "transport", "tour", "hotel", "restaurant", "shop", "other"] as const;

/** Short code ("1155") or "+66 76 123 456". Same regex as the SQL CHECK. */
export const PHONE_RE = /^(\d{3,5}|\+\d{1,3}( \d{1,4}){2,5})$/;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "not a real date");
const httpUrl = z.string().regex(/^https?:\/\/\S+$/, "must be an http(s) URL");
const text = z.string().trim().min(1);
const phone = z.string().regex(PHONE_RE, 'phone must be a short code or "+66 76 123 456" format');

/** numeric(10,2): at most 2 decimals and below 10^8. */
const thb = z
  .number()
  .nonnegative()
  .max(99_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "at most 2 decimals");

/** Field rules only (no cross-field rules). `.partial()` of it validates PATCH bodies. */
export const PriceFields = z.strictObject({
  item_key: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "item_key must be snake_case"),
  item_name_en: text,
  item_name_zh: text,
  category: z.enum(PRICE_CATEGORIES),
  area: z.enum(AREAS),
  min_thb: thb,
  max_thb: thb,
  unit: z.enum(PRICE_UNITS),
  is_fixed_by_law: z.boolean(),
  source: text,
  source_url: httpUrl.nullable(),
  collected_at: isoDate,
  notes: text.nullable(),
  notes_zh: text.nullable(),
  is_sample: z.boolean(),
});

/**
 * Cross-field rules, each reported on the field to fix (admin UI). Mirrors the SQL CHECKs (min<=max,
 * fixed-by-law ⇒ source_url) plus the content rule for "SAMPLE DATA" rows.
 */
export const PriceRowSchema = PriceFields.superRefine((r, ctx) => {
  if (r.min_thb > r.max_thb) ctx.addIssue({ code: "custom", path: ["max_thb"], message: "max_thb must be >= min_thb" });
  if (r.is_fixed_by_law && r.source_url === null) {
    ctx.addIssue({ code: "custom", path: ["source_url"], message: "is_fixed_by_law=true needs an official source_url" });
  }
  if (r.source === "SAMPLE DATA" && (!r.is_sample || r.is_fixed_by_law)) {
    ctx.addIssue({
      code: "custom",
      path: ["is_sample"],
      message: 'source "SAMPLE DATA" requires is_sample=true and is_fixed_by_law=false',
    });
  }
});
/** POST /api/admin/prices body (PriceInput). */
export const PriceInputSchema = PriceRowSchema;
/** PATCH /api/admin/prices/:id body: any subset of fields; the merged row is re-checked with PriceRowSchema. */
export const PricePatchSchema = PriceFields.partial();

export const HelpContactSchema = z
  .strictObject({
    category: z.enum(HELP_CATEGORIES),
    name_en: text,
    name_zh: text.nullable(),
    name_th: text.nullable(),
    phone: phone.nullable(),
    address: text.nullable(),
    area: text.nullable(),
    google_maps_url: httpUrl.nullable(),
    website: httpUrl.nullable(),
    hours: text.nullable(),
    languages: z.array(z.string().regex(/^[a-z]{2}$/, "ISO 639-1 code")),
    source_url: httpUrl.nullable(),
    sort_order: z.number().int(),
    verified: z.boolean(),
    is_sample: z.boolean(),
  })
  .refine((c) => c.phone === null || (c.source_url !== null && c.verified), {
    message: "a phone number needs an official source_url and verified=true (else phone must be null)",
    path: ["phone"],
  })
  .refine((c) => c.source_url !== null || !c.verified, {
    message: "verified=true needs a source_url",
    path: ["verified"],
  });

/** Field rules only (no cross-field rules). `.partial()` of it validates PATCH bodies. */
export const BusinessFields = z.strictObject({
  name: text,
  name_zh: text.nullable(),
  category: z.enum(BUSINESS_CATEGORIES),
  area: z.enum(AREAS),
  address: text.nullable(),
  phone: phone.nullable(),
  website: httpUrl.nullable(),
  google_maps_url: httpUrl.nullable(),
  source_url: httpUrl.nullable(),
  description_en: text.nullable(),
  description_zh: text.nullable(),
  criteria_met: z.array(z.enum(BUSINESS_CRITERIA)),
  is_sponsored: z.boolean(),
  verified_at: isoDate.nullable(),
  is_active: z.boolean(),
  is_sample: z.boolean(),
});

/** Cross-field rules, each reported on the field to fix. Phone rule mirrors the SQL CHECK; [SAMPLE] rules are §2.7. */
export const BusinessSchema = BusinessFields.superRefine((b, ctx) => {
  if (b.phone !== null && b.source_url === null) {
    ctx.addIssue({ code: "custom", path: ["source_url"], message: "a phone number needs a source_url (else phone must be null)" });
  }
  if (b.phone !== null && b.verified_at === null) {
    ctx.addIssue({ code: "custom", path: ["verified_at"], message: "a phone number needs verified_at (else phone must be null)" });
  }
  if (b.is_sample && !b.name.startsWith("[SAMPLE] ")) {
    ctx.addIssue({ code: "custom", path: ["name"], message: 'sample businesses are fictional and their name must start with "[SAMPLE] "' });
  }
  for (const k of ["phone", "website", "google_maps_url"] as const) {
    if (b.is_sample && b[k] !== null) {
      ctx.addIssue({ code: "custom", path: [k], message: `fictional [SAMPLE] businesses must have ${k} = null` });
    }
  }
});
/** POST /api/admin/businesses body (BusinessInput). */
export const BusinessInputSchema = BusinessSchema;
/** PATCH /api/admin/businesses/:id body: any subset of fields; the merged row is re-checked with BusinessSchema. */
export const BusinessPatchSchema = BusinessFields.partial();

export const HelpJsonSchema = z.strictObject({
  contacts: z.array(z.unknown()),
  businesses: z.array(z.unknown()),
});

/**
 * Zod issues → `ApiError.error.fields` (path → first message). Unknown keys → "unknown field";
 * issues on the whole body use the key "body".
 */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (path: PropertyKey[], msg: string) => {
    const k = path.map(String).join(".") || "body";
    out[k] ??= msg;
  };
  for (const i of err.issues) {
    if (i.code === "unrecognized_keys") for (const key of i.keys) put([...i.path, key], "unknown field");
    else put(i.path, i.message);
  }
  return out;
}
