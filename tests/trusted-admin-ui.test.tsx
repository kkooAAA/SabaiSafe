// @vitest-environment jsdom
// P4-1 Trusted Services (order by name, Sponsored label visible, criteria chips) and P4-3 admin UI: form helpers in
// parity with backend's schemas (lib/db/schema.ts), and the console rendered with a stubbed /api/admin/*.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import type { Business, PriceRef } from "@/types/api";
import { BUSINESS_CRITERIA } from "@/types/protocol";
import { BusinessSchema, PriceRowSchema } from "@/lib/db/schema";
import { businessCategories, filterBusinesses, metCriteria, orderBusinesses } from "@/components/help/trusted";
import { BusinessDirectory } from "@/components/help/BusinessDirectory";
import {
  FIELDS,
  apiFieldErrors,
  diffBody,
  emptyValues,
  fromFormValues,
  parseNumber,
  searchRows,
  toFormValues,
} from "@/components/admin/admin-form";
import { AdminConsole, adminErrorKey } from "@/components/admin/AdminConsole";

Element.prototype.scrollIntoView = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
const B = (over: Partial<Business> = {}): Business => ({
  id: `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`,
  name: `Shop ${n}`,
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
const PRICE: PriceRef = {
  id: "00000000-0000-4000-a000-00000000aaaa",
  item_key: "taxi_airport_patong",
  item_name_en: "Taxi airport → Patong",
  item_name_zh: "机场到芭东出租车",
  category: "transport",
  area: "Patong",
  min_thb: 800,
  max_thb: 1200,
  unit: "per_trip",
  is_fixed_by_law: false,
  source: "SAMPLE DATA",
  source_url: null,
  collected_at: "2026-11-01",
  notes: null,
  notes_zh: null,
  is_sample: true,
};

// ------------------------------------------------------------------ Trusted Services helpers
describe("orderBusinesses: by name only; sponsorship never reorders; inactive dropped", () => {
  const list = [B({ name: "zeta" }), B({ name: "Alpha", is_sponsored: true }), B({ name: "beta" }), B({ name: "Ámbar" }), B({ name: "gone", is_active: false })];
  it("orders case- and accent-insensitively by name", () =>
    expect(orderBusinesses(list).map((b) => b.name)).toEqual(["Alpha", "Ámbar", "beta", "zeta"]));
  it("flipping every is_sponsored gives the same order", () => {
    const flipped = list.map((b) => ({ ...b, is_sponsored: !b.is_sponsored }));
    expect(orderBusinesses(flipped).map((b) => b.id)).toEqual(orderBusinesses(list).map((b) => b.id));
  });
  it("is stable (id tiebreak) for equal names and doesn't mutate input", () => {
    const same = [B({ name: "Same" }), B({ name: "same" })];
    const copy = JSON.stringify(same);
    expect(orderBusinesses(same).map((b) => b.id)).toEqual([...same].map((b) => b.id).sort());
    expect(JSON.stringify(same)).toBe(copy);
  });
  it("metCriteria: known keys only, in BUSINESS_CRITERIA order, deduped", () =>
    expect(metCriteria(["receipts", "cheap", "registered_business", "receipts"])).toEqual(["registered_business", "receipts"]));
  it("categories and filter", () => {
    const l = [B({ category: "tour" }), B({ category: "rental" })];
    expect(businessCategories(l)).toEqual(["rental", "tour"]);
    expect(filterBusinesses(l, "tour")).toHaveLength(1);
    expect(filterBusinesses(l, null)).toHaveLength(2);
  });
});

function renderDir(locale: "en" | "zh", businesses: Business[]) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
      <BusinessDirectory businesses={businesses} />
    </NextIntlClientProvider>,
  );
}

describe("BusinessDirectory (jsdom)", () => {
  it.each(["en", "zh"] as const)("%s: every sponsored card shows the Sponsored label as visible text; others don't", (locale) => {
    const label = (locale === "en" ? en : zh).common.sponsored;
    renderDir(locale, [B({ name: "A", is_sponsored: true }), B({ name: "B" }), B({ name: "C", is_sponsored: true })]);
    const cards = screen.getAllByTestId("business-card");
    expect(cards).toHaveLength(3);
    const has = cards.map((c) => (c.textContent ?? "").includes(label));
    expect(has).toEqual([true, false, true]);
    for (const c of cards.filter((_, i) => has[i])) {
      const el = within(c).getByText(label);
      expect(el).toBeVisible();
      expect(el.closest("[aria-hidden=true]")).toBeNull();
      expect(el.className).not.toMatch(/sr-only/);
    }
  });

  it("render order equals name order, sponsored or not", () => {
    renderDir("en", [B({ name: "Zulu", is_sponsored: true }), B({ name: "alpha" }), B({ name: "Mike", is_sponsored: true })]);
    const names = screen.getAllByTestId("business-card").map((c) => within(c).getByRole("heading").textContent);
    expect(names).toEqual(["alpha", "Mike", "Zulu"]);
  });

  it.each(["en", "zh"] as const)("%s: criteria chips are translated (no raw keys), legend lists all criteria, disclaimer shown", (locale) => {
    const m = locale === "en" ? en : zh;
    renderDir(locale, [B({ criteria_met: [...BUSINESS_CRITERIA] })]);
    const text = document.body.textContent ?? "";
    for (const k of BUSINESS_CRITERIA) {
      if (k.includes("_")) expect(text).not.toContain(k); // raw snake_case keys never shown ("insurance" is also a real word)
      expect(text).toContain((m.help.criteria as Record<string, string>)[k]);
      expect(text).toContain((m.help.criteriaHelp as Record<string, string>)[k]);
    }
    expect(screen.getByTestId("trusted-disclaimer")).toHaveTextContent(m.help.notEndorsement);
  });

  it("inactive businesses are not rendered; empty list shows the empty message", () => {
    renderDir("en", [B({ name: "Gone", is_active: false })]);
    expect(screen.queryAllByTestId("business-card")).toHaveLength(0);
    expect(document.body.textContent).toContain(en.help.noBusinesses);
  });

  it("category chips filter and are toggle buttons with aria-pressed", () => {
    renderDir("en", [B({ name: "R", category: "rental" }), B({ name: "T", category: "tour" })]);
    const group = screen.getByRole("group", { name: en.help.filterLabel });
    const tour = within(group).getByRole("button", { name: en.help.businessCategory.tour });
    fireEvent.click(tour);
    expect(tour).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("business-card")).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ admin form ↔ server schema parity
const VALID_PRICE_FORM = () => ({
  ...emptyValues("prices"),
  item_key: "qa_boat",
  item_name_en: "Boat",
  item_name_zh: "船",
  category: "transport",
  area: "Patong",
  min_thb: "1,500",
  max_thb: "２５００",
  unit: "per_trip",
  source: "QA survey",
  source_url: "https://example.org/x",
  collected_at: "2026-11-01",
});
const VALID_BIZ_FORM = () => ({
  ...emptyValues("businesses"),
  name: "QA Rentals",
  category: "rental",
  area: "Kata",
  phone: "+66 76 123 456",
  source_url: "https://example.org/reg",
  verified_at: "2026-11-01",
  criteria_met: ["receipts", "registered_business"],
});

describe("admin form helpers", () => {
  it("parseNumber: commas, spaces, full-width digits; invalid ⇒ NaN; empty ⇒ null", () => {
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber(" ３００ ")).toBe(300);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("-5")).toBeNaN();
    expect(parseNumber("abc")).toBeNaN();
    expect(parseNumber("")).toBeNull();
  });

  it("a valid price form produces a body the SERVER schema accepts", () => {
    const r = fromFormValues("prices", VALID_PRICE_FORM());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.min_thb).toBe(1500);
    expect(r.body.max_thb).toBe(2500);
    expect(r.body.notes).toBeNull(); // empty nullable ⇒ null, never ""
    const s = PriceRowSchema.safeParse(r.body);
    expect(s.success, JSON.stringify(s.error?.issues)).toBe(true);
  });

  it("a valid business form produces a body the SERVER schema accepts; criteria in canonical order", () => {
    const r = fromFormValues("businesses", VALID_BIZ_FORM());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.criteria_met).toEqual(["registered_business", "receipts"]);
    const s = BusinessSchema.safeParse(r.body);
    expect(s.success, JSON.stringify(s.error?.issues)).toBe(true);
  });

  it("form bodies carry exactly the schema's fields (no id, no extras the strict server would reject)", () => {
    const p = fromFormValues("prices", VALID_PRICE_FORM());
    const b = fromFormValues("businesses", VALID_BIZ_FORM());
    if (!p.ok || !b.ok) throw new Error("expected ok");
    expect(Object.keys(p.body).sort()).toEqual(FIELDS.prices.map((f) => f.name).sort());
    expect(Object.keys(b.body).sort()).toEqual(FIELDS.businesses.map((f) => f.name).sort());
    expect(p.body).not.toHaveProperty("id");
  });

  // Every rule the client checks: client error ⇔ server rejects the same field.
  it.each<[string, "prices" | "businesses", Record<string, unknown>, string, string]>([
    ["min > max", "prices", { min_thb: "3000", max_thb: "2000" }, "max_thb", "min_max"],
    ["fixed by law, no source", "prices", { is_fixed_by_law: true, source_url: "" }, "source_url", "fixed_needs_source"],
    ["slug", "prices", { item_key: "Boat Ride" }, "item_key", "slug"],
    ["bad url", "prices", { source_url: "javascript:alert(1)" }, "source_url", "url"],
    ["bad date", "prices", { collected_at: "01/11/2026" }, "collected_at", "date"],
    ["not a number", "prices", { min_thb: "abc" }, "min_thb", "number"],
    ["required", "prices", { item_name_en: "  " }, "item_name_en", "required"],
    ["phone, no source", "businesses", { source_url: "" }, "source_url", "phone_needs_source"],
    ["phone, no verified", "businesses", { verified_at: "" }, "verified_at", "phone_needs_verified"],
    ["bad website", "businesses", { website: "ftp://x.org" }, "website", "url"],
  ])("client rule %s ⇒ admin.errors.%s, and the server rejects that field too", (_n, entity, over, field, key) => {
    const base = entity === "prices" ? VALID_PRICE_FORM() : VALID_BIZ_FORM();
    const r = fromFormValues(entity, { ...base, ...over } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[field]).toBe(key);
    expect((en.admin.errors as Record<string, string>)[key], `en admin.errors.${key}`).toBeTruthy();
    expect((zh.admin.errors as Record<string, string>)[key], `zh admin.errors.${key}`).toBeTruthy();
  });

  it("toFormValues ∘ fromFormValues round-trips a stored row", () => {
    const v = toFormValues("prices", PRICE);
    const r = fromFormValues("prices", v);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const { id: _ignored, ...stored } = PRICE;
    void _ignored;
    expect(r.body).toEqual(stored);
  });

  it("diffBody sends only changed fields (null and missing are equal)", () => {
    expect(diffBody({ a: 1, b: null, c: [1] }, { a: 1, b: null, c: [1], d: null })).toEqual({});
    expect(diffBody({ a: 1, c: [1] }, { a: 2, c: [1, 2] })).toEqual({ a: 2, c: [1, 2] });
  });

  it("apiFieldErrors maps server paths to fields (criteria_met.2 ⇒ criteria_met), ignores junk", () => {
    expect(apiFieldErrors({ error: { code: "bad_request", message: "x", fields: { "criteria_met.2": "bad", max_thb: "lt min" } } })).toEqual({
      criteria_met: "bad",
      max_thb: "lt min",
    });
    expect(apiFieldErrors(null)).toEqual({});
    expect(apiFieldErrors({ error: { fields: "nope" } })).toEqual({});
  });

  it("searchRows is case-insensitive across text columns", () => {
    expect(searchRows([PRICE], "PATONG")).toHaveLength(1);
    expect(searchRows([PRICE], "芭东")).toHaveLength(1);
    expect(searchRows([PRICE], "zzz")).toHaveLength(0);
    expect(searchRows([PRICE], "  ")).toHaveLength(1);
  });

  it("adminErrorKey maps the contract codes to existing message keys", () => {
    const cases: [number, string, string][] = [
      [0, "network", "network"],
      [401, "unauthorized", "unauthorized"],
      [503, "unavailable", "unavailable"],
      [404, "not_found", "not_found"],
      [409, "conflict", "conflict"],
      [400, "bad_request", "invalid"],
      [500, "internal", "generic"],
    ];
    for (const [status, code, key] of cases) {
      expect(adminErrorKey({ status, code })).toBe(key);
      expect((en.admin.errors as Record<string, string>)[key]).toBeTruthy();
      expect((zh.admin.errors as Record<string, string>)[key]).toBeTruthy();
    }
  });
});

// ------------------------------------------------------------------ AdminConsole (jsdom, stubbed API)
type Call = { url: string; method: string; body: unknown };
function setupConsole(locale: "en" | "zh", handler: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const c = { url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null };
      calls.push(c);
      return handler(c);
    }),
  );
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
      <AdminConsole />
    </NextIntlClientProvider>,
  );
  return calls;
}
const sample = { "x-admin-persisted": "false", "cache-control": "no-store" };
const list = (results: unknown[]) => Response.json({ results, persisted: false }, { headers: sample });

describe("AdminConsole", () => {
  it.each(["en", "zh"] as const)("%s: loads prices, shows the not-persisted (sample mode) notice", async (locale) => {
    setupConsole(locale, () => list([PRICE]));
    await screen.findAllByTestId("admin-row");
    expect(screen.getByTestId("admin-sample-mode")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/admin\.[a-z]+\.[a-z]/); // no raw message keys
  });

  it("client validation blocks a bad save without calling the API", async () => {
    const calls = setupConsole("en", () => list([]));
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(screen.getByTestId("admin-add"));
    const form = await screen.findByTestId("admin-form");
    fireEvent.click(within(form).getByTestId("admin-save"));
    await waitFor(() => expect(form.querySelectorAll("[aria-invalid=true]").length).toBeGreaterThan(0));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("a server 400 with fields is shown on the matching input", async () => {
    const calls = setupConsole("en", (c) =>
      c.method === "PATCH"
        ? Response.json({ error: { code: "bad_request", message: "invalid", fields: { notes: "notes rejected by server" } } }, { status: 400, headers: sample })
        : list([PRICE]),
    );
    await screen.findAllByTestId("admin-row");
    fireEvent.click(screen.getAllByTestId("admin-edit")[0]!);
    const form = await screen.findByTestId("admin-form");
    // The client rejects an unknown area itself (KNOWN_AREAS); use a field only the server rejects here.
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const area = within(form).getByLabelText(new RegExp(`^${escapeRe(en.admin.field.notes)}`, "i")) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "server says no" } });
    fireEvent.click(within(form).getByTestId("admin-save"));
    await waitFor(() => expect(area).toHaveAttribute("aria-invalid", "true"));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe(`/api/admin/prices/${PRICE.id}`);
    expect(patch.body).toEqual({ notes: "server says no" }); // only the changed field
    expect(document.body.textContent).toContain("notes rejected by server");
  });

  it("delete asks for confirmation first, then sends DELETE", async () => {
    const calls = setupConsole("en", (c) => (c.method === "DELETE" ? new Response(null, { status: 204, headers: sample }) : list([PRICE])));
    await screen.findAllByTestId("admin-row");
    fireEvent.click(screen.getAllByTestId("admin-delete")[0]!);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(await screen.findByTestId("admin-delete-yes"));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === `/api/admin/prices/${PRICE.id}`)).toBe(true));
  });

  it("a 401 from the API shows the unauthorized message (no crash)", async () => {
    setupConsole("en", () => Response.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }));
    expect(await screen.findByTestId("admin-load-error")).toHaveTextContent(en.admin.errors.unauthorized);
  });
});

describe("admin client rejects an unknown area before calling the server", () => {
  it("Pattaya ⇒ client error on area, no PATCH sent", async () => {
    const calls = setupConsole("en", () => list([PRICE]));
    await screen.findAllByTestId("admin-row");
    fireEvent.click(screen.getAllByTestId("admin-edit")[0]!);
    const form = await screen.findByTestId("admin-form");
    const area = within(form).getByLabelText(new RegExp(`^${en.admin.field.area}`, "i")) as HTMLInputElement;
    fireEvent.change(area, { target: { value: "Pattaya" } });
    fireEvent.click(within(form).getByTestId("admin-save"));
    await waitFor(() => expect(area).toHaveAttribute("aria-invalid", "true"));
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
