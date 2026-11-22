// @vitest-environment jsdom
// qa P4 review: admin client validation must never say "ok" for a body the server schema rejects
// (lib/db/schema.ts is imported, never copied, so this can't drift), shared lists stay equal to the
// schema's, no hotline numbers other than the four official ones in UI strings, and P4-4 shell a11y.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import type { Business } from "@/types/api";
import {
  AREAS,
  BUSINESS_CATEGORIES as SCHEMA_BUSINESS_CATEGORIES,
  BusinessFields,
  BusinessSchema,
  PRICE_CATEGORIES as SCHEMA_PRICE_CATEGORIES,
  PriceFields,
  PriceRowSchema,
} from "@/lib/db/schema";
import { HOTLINES } from "@/lib/hotlines";
import {
  BUSINESS_CATEGORIES as FORM_BUSINESS_CATEGORIES,
  FIELDS,
  KNOWN_AREAS,
  PRICE_CATEGORIES as FORM_PRICE_CATEGORIES,
  emptyValues,
  fromFormValues,
  type FormValues,
} from "@/components/admin/admin-form";
import { BUSINESS_CATEGORIES as TRUSTED_CATEGORIES } from "@/components/help/trusted";
import { BusinessDirectory } from "@/components/help/BusinessDirectory";
import { findPhoneLike } from "./helpers/phones";

const ROOT = join(__dirname, "..");
afterEach(cleanup);

const PRICE_FORM = (): FormValues => ({
  ...emptyValues("prices"),
  item_key: "qa_boat",
  item_name_en: "Boat",
  item_name_zh: "船",
  category: "transport",
  area: "Patong",
  min_thb: "1500",
  max_thb: "2500",
  unit: "per_trip",
  source: "QA survey",
  source_url: "https://example.org/x",
  collected_at: "2026-11-01",
});
const BIZ_FORM = (): FormValues => ({
  ...emptyValues("businesses"),
  name: "QA Rentals",
  category: "rental",
  area: "Kata",
  phone: "+66 76 123 456",
  source_url: "https://example.org/reg",
  verified_at: "2026-11-01",
});
const SAMPLE_BIZ: FormValues = { name: "[SAMPLE] QA Rentals", is_sample: true, phone: "", verified_at: "" };

type Entity = "prices" | "businesses";
const schemaFor = (e: Entity) => (e === "prices" ? PriceRowSchema : BusinessSchema);
const base = (e: Entity) => (e === "prices" ? PRICE_FORM() : BIZ_FORM());

describe("admin client ⇔ server schema parity (server rejects ⇒ client rejects on the same field)", () => {
  it.each<[string, Entity, FormValues, string]>([
    // 1. impossible dates
    ["collected_at 2026-02-30", "prices", { collected_at: "2026-02-30" }, "collected_at"],
    ["collected_at 2026-04-31", "prices", { collected_at: "2026-04-31" }, "collected_at"],
    ["verified_at 2026-02-30", "businesses", { verified_at: "2026-02-30" }, "verified_at"],
    // 2. URLs the server regex refuses
    ["source_url without //", "prices", { source_url: "http:example.com" }, "source_url"],
    ["source_url with a space", "prices", { source_url: "https://example.org/a b" }, "source_url"],
    ["website without //", "businesses", { website: "https:example.org" }, "website"],
    // 3. [SAMPLE] rules
    ["SAMPLE DATA source, is_sample off", "prices", { source: "SAMPLE DATA", is_sample: false }, "is_sample"],
    ["SAMPLE DATA source, fixed by law", "prices", { source: "SAMPLE DATA", is_sample: true, is_fixed_by_law: true }, "is_sample"],
    ["sample business without [SAMPLE] prefix", "businesses", { ...SAMPLE_BIZ, name: "QA Rentals" }, "name"],
    ["sample business with a phone", "businesses", { ...SAMPLE_BIZ, phone: "+66 76 123 456", verified_at: "2026-11-01" }, "phone"],
    ["sample business with a website", "businesses", { ...SAMPLE_BIZ, website: "https://example.org" }, "website"],
    ["sample business with a maps url", "businesses", { ...SAMPLE_BIZ, google_maps_url: "https://maps.example.org/x" }, "google_maps_url"],
    // 4. phone format
    ["phone 076-123456", "businesses", { phone: "076-123456" }, "phone"],
    ["phone 12", "businesses", { phone: "12" }, "phone"],
    // 5. item_key slug
    ["item_key _a", "prices", { item_key: "_a" }, "item_key"],
    ["item_key a_", "prices", { item_key: "a_" }, "item_key"],
    ["item_key a__b", "prices", { item_key: "a__b" }, "item_key"],
    // 6. numeric(10,2)
    ["min_thb 3 decimals", "prices", { min_thb: "1.234" }, "min_thb"],
    ["max_thb above numeric(10,2)", "prices", { max_thb: "100000000" }, "max_thb"],
  ])("%s", (_name, entity, over, field) => {
    const r = fromFormValues(entity, { ...base(entity), ...over });
    if (r.ok) {
      const s = schemaFor(entity).safeParse(r.body);
      // The case must be a real server rejection, otherwise the table is wrong.
      expect(s.success, "test case should be rejected by the server schema").toBe(false);
      expect.fail(`client said ok, server rejects: ${JSON.stringify(s.error?.issues.map((i) => [i.path.join("."), i.message]))}`);
    }
    expect(r.errors[field], `client error on ${field}; got ${JSON.stringify(r.errors)}`).toBeTruthy();
    for (const m of [en, zh]) expect((m.admin.errors as Record<string, string>)[r.errors[field]!]).toBeTruthy();
  });

  it.each<[string, Entity, FormValues]>([
    ["leap day", "prices", { collected_at: "2024-02-29" }],
    ["multi-part slug", "prices", { item_key: "a_b_1" }],
    ["2 decimals and the max", "prices", { min_thb: "1.25", max_thb: "99,999,999.99" }],
    ["sample price", "prices", { source: "SAMPLE DATA", is_sample: true, source_url: "" }],
    ["short-code phone", "businesses", { phone: "1155" }],
    ["sample business", "businesses", SAMPLE_BIZ],
  ])("positive control: %s passes both client and server", (_name, entity, over) => {
    const r = fromFormValues(entity, { ...base(entity), ...over });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    if (!r.ok) return;
    const s = schemaFor(entity).safeParse(r.body);
    expect(s.success, JSON.stringify(s.error?.issues)).toBe(true);
  });
});

describe("admin/trusted lists equal the server schema's", () => {
  it("areas and categories", () => {
    expect([...KNOWN_AREAS]).toEqual([...AREAS]);
    expect([...FORM_PRICE_CATEGORIES]).toEqual([...SCHEMA_PRICE_CATEGORIES]);
    expect([...FORM_BUSINESS_CATEGORIES]).toEqual([...SCHEMA_BUSINESS_CATEGORIES]);
    expect([...TRUSTED_CATEGORIES]).toEqual([...SCHEMA_BUSINESS_CATEGORIES]);
  });
  it("form fields are exactly the schema's columns", () => {
    expect(FIELDS.prices.map((f) => f.name).sort()).toEqual(Object.keys(PriceFields.shape).sort());
    expect(FIELDS.businesses.map((f) => f.name).sort()).toEqual(Object.keys(BusinessFields.shape).sort());
  });
  it("every select option and checkbox option has an en and zh label (when namespaced)", () => {
    const get = (m: unknown, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);
    for (const f of [...FIELDS.prices, ...FIELDS.businesses]) {
      if (!f.optionNs || !f.options) continue;
      for (const o of f.options) for (const m of [en, zh]) expect(get(m, `${f.optionNs}.${o}`), `${f.optionNs}.${o}`).toBeTruthy();
    }
  });
});

describe("no hotline numbers other than 1155 / 191 / 1669 / 1166 in UI strings", () => {
  const allowed = new Set(HOTLINES.map((h) => String(h.number)));
  const leaves = (o: unknown, path = ""): [string, string][] =>
    typeof o === "string"
      ? [[path, o]]
      : o && typeof o === "object"
        ? Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
        : [];

  it("official set is the four from CLAUDE.md", () => expect([...allowed].sort()).toEqual(["1155", "1166", "1669", "191"]));

  it.each([
    ["en", en],
    ["zh", zh],
  ] as const)("messages/%s.json: no long phone numbers, no unknown 3–5 digit short codes", (_l, m) => {
    const bad: string[] = [];
    for (const [path, s] of leaves(m)) {
      if (findPhoneLike(s).length) bad.push(`${path}: ${s}`);
      for (const n of s.match(/(?<![\d.,:/-])\d{3,5}(?![\d.,:/-])/g) ?? []) {
        if (allowed.has(n)) continue;
        if (/^(19|20|25)\d\d$/.test(n)) continue; // years (incl. B.E.)
        if (/(e\.g\.|例如)\s*\d/.test(s)) continue; // price examples ("e.g. 1200")
        bad.push(`${path}: ${n} in ${JSON.stringify(s)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("help, admin, shared and shell components: no tel: link or quoted number outside the official set", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []));
    const bad: string[] = [];
    for (const dir of ["help", "admin", "shared", "shell"]) {
      for (const f of walk(join(ROOT, "components", dir))) {
        // Comments may show the stored format ("+66 76 123 456"); only code can reach the UI.
        const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
        for (const m of src.matchAll(/tel:\+?(\d[\d -]*)|["'`](\d{3,5})["'`]/g)) {
          const n = (m[1] ?? m[2] ?? "").replace(/\D/g, "");
          if (n && !allowed.has(n)) bad.push(`${f}: ${m[0]}`);
        }
        bad.push(...findPhoneLike(src).map((p) => `${f}: ${p}`));
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("Trusted Services: sponsored listings never reordered and labelled (zh, mixed scripts)", () => {
  let n = 0;
  const B = (over: Partial<Business>): Business => ({
    id: `00000000-0000-4000-b000-${String(++n).padStart(12, "0")}`,
    name: "x",
    name_zh: null,
    category: "rental",
    area: "Patong",
    address: null,
    phone: null,
    website: null,
    google_maps_url: null,
    source_url: null,
    description_en: null,
    description_zh: null,
    criteria_met: [],
    is_sponsored: false,
    verified_at: null,
    is_active: true,
    is_sample: false,
    ...over,
  });

  it("zh: order follows the English name (same in every UI language), not name_zh and not sponsorship", () => {
    const list = [
      B({ name: "Charlie", name_zh: "阿", is_sponsored: true }),
      B({ name: "Alpha", name_zh: "左" }),
      B({ name: "Bravo", name_zh: "中", is_sponsored: true }),
    ];
    const names = (locale: "en" | "zh") => {
      render(
        <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
          <BusinessDirectory businesses={list} />
        </NextIntlClientProvider>,
      );
      const out = screen.getAllByTestId("business-card").map((c) => ({
        h: within(c).getByRole("heading").textContent,
        sponsored: (c.textContent ?? "").includes((locale === "en" ? en : zh).common.sponsored),
      }));
      cleanup();
      return out;
    };
    expect(names("en")).toEqual([
      { h: "Alpha", sponsored: false },
      { h: "Bravo", sponsored: true },
      { h: "Charlie", sponsored: true },
    ]);
    expect(names("zh")).toEqual([
      { h: "左", sponsored: false },
      { h: "中", sponsored: true },
      { h: "阿", sponsored: true },
    ]);
  });
});

describe("P4-4 shell a11y (source checks)", () => {
  it("layout has main#main and the header has a skip link to it, translated in en and zh", () => {
    const layout = readFileSync(join(ROOT, "app", "[locale]", "layout.tsx"), "utf8");
    expect(layout).toMatch(/<main id="main"/);
    const header = readFileSync(join(ROOT, "components", "shell", "Header.tsx"), "utf8");
    expect(header).toMatch(/href="#main"/);
    expect(header).toContain('t("skipToContent")');
    const get = (m: unknown) => JSON.stringify(m).includes('"skipToContent"');
    expect(get(en) && get(zh)).toBe(true);
  });

  it("streamed answers announce politely and mark busy (Legal, Price, Report)", () => {
    const files = readdirSync(join(ROOT, "components"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
      .map((e) => readFileSync(join(e.parentPath, e.name), "utf8"));
    for (const dir of ["legal", "price", "report"]) {
      const src = readdirSync(join(ROOT, "components", dir))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => readFileSync(join(ROOT, "components", dir, f), "utf8"))
        .join("\n");
      expect(src, dir).toMatch(/aria-live="polite"|aria-live=\{/);
      expect(src, dir).toMatch(/aria-busy=/);
    }
    expect(files.length).toBeGreaterThan(0);
  });
});
