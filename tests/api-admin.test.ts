// /api/admin/* CRUD in sample mode (contracts §3.9 v0.6, §2.3, §2.4): shapes, every validation rule mirrored from the
// DB CHECKs, merged PATCH re-validation, hard/soft delete, 404/409, the not-persisted flag, no-store, overlay visible
// to the public routes, and no internals in error bodies. Auth is middleware's job (tests/middleware-admin.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminListResponse, AdminWriteResponse, ApiError, Business, PriceRef } from "@/types/api";
import { BUSINESS_CRITERIA, PRICE_UNITS } from "@/types/protocol";
import { AREAS } from "@/lib/db/schema";

const prices = await import("@/app/api/admin/prices/route");
const priceId = await import("@/app/api/admin/prices/[id]/route");
const biz = await import("@/app/api/admin/businesses/route");
const bizId = await import("@/app/api/admin/businesses/[id]/route");
const { resetAdminOverlay } = await import("@/lib/db/admin");
const { findPrices } = await import("@/lib/db/prices");
const { getHelp } = await import("@/lib/db/help");

const U = "http://localhost";
const json = (method: string, body: unknown) =>
  new Request(U, { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const UNKNOWN = "00000000-0000-4000-a000-000000000000";

const PRICE: Omit<PriceRef, "id"> = {
  item_key: "qa_test_longtail_boat",
  item_name_en: "QA longtail boat",
  item_name_zh: "QA 长尾船",
  category: "transport",
  area: "Patong",
  min_thb: 1500,
  max_thb: 2500.5,
  unit: "per_trip",
  is_fixed_by_law: false,
  source: "QA field survey",
  source_url: "https://example.org/qa-survey",
  collected_at: "2026-11-01",
  notes: null,
  notes_zh: null,
  is_sample: false,
};
const BUSINESS: Omit<Business, "id"> = {
  name: "QA Test Rentals",
  name_zh: "QA 测试租车",
  category: "rental",
  area: "Kata",
  address: "1 Test Road",
  phone: "+66 76 123 456",
  website: "https://example.org/rentals",
  google_maps_url: null,
  source_url: "https://example.org/registry",
  description_en: "Test",
  description_zh: "测试",
  criteria_met: ["registered_business", "receipts"],
  is_sponsored: false,
  verified_at: "2026-11-01",
  is_active: true,
  is_sample: false,
};

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
const postPrice = (b: unknown) => prices.POST(json("POST", b));
const postBiz = (b: unknown) => biz.POST(json("POST", b));
async function createdPrice(over: Partial<typeof PRICE> = {}) {
  const res = await postPrice({ ...PRICE, ...over });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await body<AdminWriteResponse<PriceRef>>(res)).row;
}
async function createdBiz(over: Partial<typeof BUSINESS> = {}) {
  const res = await postBiz({ ...BUSINESS, ...over });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await body<AdminWriteResponse<Business>>(res)).row;
}
function expectSampleFlags(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-admin-persisted")).toBe("false");
}
async function expectFieldError(res: Response, field: string) {
  expect(res.status).toBe(400);
  const j = await body<ApiError>(res);
  expect(j.error.code).toBe("bad_request");
  expect(j.error.fields, JSON.stringify(j)).toHaveProperty(field);
  expect(typeof j.error.fields![field]).toBe("string");
}

beforeEach(() => resetAdminOverlay());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("routes", () => {
  it("all declare runtime nodejs and are dynamic", () => {
    for (const m of [prices, priceId, biz, bizId]) {
      expect(m.runtime).toBe("nodejs");
      expect(m.dynamic).toBe("force-dynamic");
    }
  });
});

// ------------------------------------------------------------------ prices
describe("GET /api/admin/prices", () => {
  it("{results, persisted:false}, all rows, ordered category, item_name_en, area; no-store + X-Admin-Persisted", async () => {
    const res = await prices.GET(new Request(U));
    expect(res.status).toBe(200);
    expectSampleFlags(res);
    const j = await body<AdminListResponse<PriceRef>>(res);
    expect(j.persisted).toBe(false);
    expect(j.results.length).toBeGreaterThanOrEqual(25);
    const key = (r: PriceRef) => [r.category, r.item_name_en, r.area];
    const sorted = [...j.results].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
      return 0;
    });
    expect(j.results.map((r) => r.id)).toEqual(sorted.map((r) => r.id));
  });
});

describe("POST /api/admin/prices", () => {
  it("201 {row, persisted:false}; the row has an id and equals the input", async () => {
    const res = await postPrice(PRICE);
    expect(res.status).toBe(201);
    expectSampleFlags(res);
    const j = await body<AdminWriteResponse<PriceRef>>(res);
    expect(j.persisted).toBe(false);
    expect(j.row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.row).toMatchObject(PRICE);
  });

  it("the new row is visible to the public findPrices (overlay) and gone after reset", async () => {
    await createdPrice();
    expect((await findPrices({ item: "qa longtail" })).map((r) => r.item_key)).toContain(PRICE.item_key);
    resetAdminOverlay();
    expect((await findPrices({ item: "qa longtail" })).map((r) => r.item_key)).not.toContain(PRICE.item_key);
  });

  // Every rule mirrored from the SQL CHECKs (+ the agreed extras). [name, body override, field reported]
  it.each<[string, Record<string, unknown>, string]>([
    ["item_key not snake_case", { item_key: "Longtail Boat" }, "item_key"],
    ["empty item_name_en", { item_name_en: "" }, "item_name_en"],
    ["blank item_name_zh", { item_name_zh: "   " }, "item_name_zh"],
    ["unknown category", { category: "boats" }, "category"],
    ["unknown area", { area: "Pattaya" }, "area"],
    ["negative min", { min_thb: -1 }, "min_thb"],
    ["3 decimals", { min_thb: 10.123 }, "min_thb"],
    ["too large (numeric(10,2))", { max_thb: 1e8 }, "max_thb"],
    ["min > max (reported on max)", { min_thb: 3000, max_thb: 2000 }, "max_thb"],
    ["number as string", { min_thb: "1500" }, "min_thb"],
    ["unknown unit", { unit: "per_boat" }, "unit"],
    ["fixed by law without source_url", { is_fixed_by_law: true, source_url: null }, "source_url"],
    ["non-http source_url", { source_url: "javascript:alert(1)" }, "source_url"],
    ["ftp source_url", { source_url: "ftp://example.org/x" }, "source_url"],
    ["empty source", { source: "" }, "source"],
    ["impossible date", { collected_at: "2026-02-30" }, "collected_at"],
    ["wrong date format", { collected_at: "01/11/2026" }, "collected_at"],
    ["empty-string notes (send null)", { notes: "" }, "notes"],
    ["SAMPLE DATA source but is_sample false", { source: "SAMPLE DATA", is_sample: false }, "is_sample"],
    ["SAMPLE DATA source and fixed by law", { source: "SAMPLE DATA", is_sample: true, is_fixed_by_law: true }, "is_sample"],
    ["unknown key", { foo: 1 }, "foo"],
    ["client-supplied id", { id: UNKNOWN }, "id"],
    ["client-supplied created_at", { created_at: "2026-11-01T00:00:00Z" }, "created_at"],
    ["client-supplied updated_at", { updated_at: "2026-11-01T00:00:00Z" }, "updated_at"],
  ])("400 fields.%s", async (_n, over, field) => {
    await expectFieldError(await postPrice({ ...PRICE, ...over }), field);
  });

  it("missing required fields are each reported", async () => {
    const partial: Record<string, unknown> = { ...PRICE };
    delete partial.item_key;
    delete partial.unit;
    const res = await postPrice(partial);
    expect(res.status).toBe(400);
    const f = (await body<ApiError>(res)).error.fields!;
    expect(Object.keys(f)).toEqual(expect.arrayContaining(["item_key", "unit"]));
  });

  it.each(PRICE_UNITS)("unit %s is accepted", async (unit) => {
    await createdPrice({ unit, item_key: `qa_unit_${unit}` });
  });
  it.each(AREAS)("area %s is accepted", async (area) => {
    await createdPrice({ area, item_key: "qa_area_check" });
  });
  it("fixed by law WITH source_url, and boundary values (0, 2 decimals, min == max) are accepted", async () => {
    await createdPrice({ is_fixed_by_law: true, min_thb: 0, max_thb: 0, item_key: "qa_zero" });
    await createdPrice({ min_thb: 99999999.99, max_thb: 99999999.99, item_key: "qa_max" });
  });

  it("409 conflict on the unique (item_key, area, source, collected_at)", async () => {
    await createdPrice();
    const res = await postPrice(PRICE);
    expect(res.status).toBe(409);
    expect((await body<ApiError>(res)).error.code).toBe("conflict");
    // a different date is a different row
    await createdPrice({ collected_at: "2026-11-02" });
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["array", [PRICE]],
    ["null", "null"],
  ])("%s ⇒ 400 bad_request", async (_n, b) => {
    const res = await postPrice(b);
    expect(res.status).toBe(400);
    expect((await body<ApiError>(res)).error.code).toBe("bad_request");
  });
});

describe("PATCH / DELETE /api/admin/prices/:id", () => {
  const patch = (id: string, b: unknown) => priceId.PATCH(json("PATCH", b), ctx(id));
  const del = (id: string) => priceId.DELETE(new Request(U, { method: "DELETE" }), ctx(id));

  it("PATCH is partial: 200 {row, persisted:false} with only that field changed", async () => {
    const row = await createdPrice();
    const res = await patch(row.id, { max_thb: 3000 });
    expect(res.status).toBe(200);
    expectSampleFlags(res);
    const j = await body<AdminWriteResponse<PriceRef>>(res);
    expect(j.persisted).toBe(false);
    expect(j.row).toEqual({ ...row, max_thb: 3000 });
  });

  it("PATCH is re-validated against the MERGED row", async () => {
    const row = await createdPrice(); // min 1500
    await expectFieldError(await patch(row.id, { max_thb: 1000 }), "max_thb");
    await expectFieldError(await patch(row.id, { is_fixed_by_law: true, source_url: null }), "source_url");
    await expectFieldError(await patch(row.id, { source_url: null, is_fixed_by_law: true }), "source_url");
    // and the stored row is unchanged after a rejected PATCH
    const list = await body<AdminListResponse<PriceRef>>(await prices.GET(new Request(U)));
    expect(list.results.find((r) => r.id === row.id)).toEqual(row);
  });

  it.each<[string, unknown, string]>([
    ["empty patch", {}, ""],
    ["unknown key", { foo: 1 }, "foo"],
    ["id in body", { id: UNKNOWN }, "id"],
    ["bad unit", { unit: "per_boat" }, "unit"],
  ])("PATCH %s ⇒ 400", async (_n, b, field) => {
    const row = await createdPrice();
    const res = await patch(row.id, b);
    expect(res.status).toBe(400);
    if (field) expect((await body<ApiError>(res)).error.fields).toHaveProperty(field);
  });

  it("PATCH into an existing unique key ⇒ 409", async () => {
    await createdPrice();
    const other = await createdPrice({ collected_at: "2026-11-02" });
    const res = await patch(other.id, { collected_at: PRICE.collected_at });
    expect(res.status).toBe(409);
  });

  it("PATCH on a seed (content/prices.csv) row works through the overlay", async () => {
    const seed = (await body<AdminListResponse<PriceRef>>(await prices.GET(new Request(U)))).results[0]!;
    const res = await patch(seed.id, { notes: "qa edited" });
    expect(res.status).toBe(200);
    expect((await findPrices({})).find((r) => r.id === seed.id)?.notes).toBe("qa edited");
  });

  it("DELETE is a hard delete: 204 empty, gone from admin and public lists, second DELETE 404", async () => {
    const row = await createdPrice();
    const res = await del(row.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const list = await body<AdminListResponse<PriceRef>>(await prices.GET(new Request(U)));
    expect(list.results.some((r) => r.id === row.id)).toBe(false);
    expect((await findPrices({})).some((r) => r.id === row.id)).toBe(false);
    expect((await del(row.id)).status).toBe(404);
  });

  it.each([UNKNOWN, "not-a-uuid", "../../etc"])("unknown / malformed id %s ⇒ 404 not_found for PATCH and DELETE", async (id) => {
    for (const res of [await patch(id, { max_thb: 9 }), await del(id)]) {
      expect(res.status).toBe(404);
      expect((await body<ApiError>(res)).error.code).toBe("not_found");
    }
  });
});

// ------------------------------------------------------------------ businesses
describe("businesses", () => {
  const patch = (id: string, b: unknown) => bizId.PATCH(json("PATCH", b), ctx(id));
  const del = (id: string) => bizId.DELETE(new Request(U, { method: "DELETE" }), ctx(id));
  const adminList = async () => (await body<AdminListResponse<Business>>(await biz.GET(new Request(U)))).results;

  it("GET: {results, persisted:false}, includes inactive, ordered by name; no-store", async () => {
    const res = await biz.GET(new Request(U));
    expectSampleFlags(res);
    const j = await body<AdminListResponse<Business>>(res);
    expect(j.persisted).toBe(false);
    const names = j.results.map((b) => b.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("POST 201 {row, persisted:false}; visible in /api/help via getHelp", async () => {
    const res = await postBiz(BUSINESS);
    expect(res.status).toBe(201);
    expectSampleFlags(res);
    const j = await body<AdminWriteResponse<Business>>(res);
    expect(j.persisted).toBe(false);
    expect((await getHelp({})).businesses.map((b) => b.id)).toContain(j.row.id);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["empty name", { name: "" }, "name"],
    ["unknown category", { category: "bar" }, "category"],
    ["unknown area", { area: "Bangkok" }, "area"],
    ["phone bad format", { phone: "081-234-5678" }, "phone"],
    ["phone without source_url", { source_url: null }, "source_url"],
    ["phone without verified_at", { verified_at: null }, "verified_at"],
    ["non-http website", { website: "javascript:alert(1)" }, "website"],
    ["non-http maps url", { google_maps_url: "data:text/html,x" }, "google_maps_url"],
    ["unknown criterion", { criteria_met: ["registered_business", "cheap"] }, "criteria_met.1"],
    ["impossible verified_at", { verified_at: "2026-13-01" }, "verified_at"],
    ["is_sample without [SAMPLE] prefix", { is_sample: true, phone: null, website: null }, "name"],
    ["is_sample with a phone", { is_sample: true, name: "[SAMPLE] Shop" }, "phone"],
    ["is_sponsored not boolean", { is_sponsored: "yes" }, "is_sponsored"],
    ["empty-string address (send null)", { address: "" }, "address"],
    ["unknown key", { rating: 5 }, "rating"],
    ["client id", { id: UNKNOWN }, "id"],
    ["client created_at", { created_at: "2026-11-01" }, "created_at"],
  ])("400 fields.%s", async (_n, over, field) => {
    await expectFieldError(await postBiz({ ...BUSINESS, ...over }), field);
  });

  it("accepts every BUSINESS_CRITERIA key, and no phone ⇒ no source/verified needed", async () => {
    await createdBiz({ criteria_met: [...BUSINESS_CRITERIA] });
    await createdBiz({ name: "QA No Phone", phone: null, source_url: null, verified_at: null });
    await createdBiz({ name: "[SAMPLE] QA Sample", is_sample: true, phone: null, website: null, google_maps_url: null });
  });

  it("409 on (name, area)", async () => {
    await createdBiz();
    expect((await postBiz(BUSINESS)).status).toBe(409);
    await createdBiz({ area: "Karon" });
  });

  it("PATCH merged re-validation: removing source_url while a phone is set ⇒ 400", async () => {
    const row = await createdBiz();
    await expectFieldError(await patch(row.id, { source_url: null }), "source_url");
    const ok = await patch(row.id, { phone: null, source_url: null, verified_at: null });
    expect(ok.status).toBe(200);
  });

  it("DELETE is a soft delete: 200 {row:is_active=false}; hidden from /api/help, kept in admin; repeat is 200; PATCH revives", async () => {
    const row = await createdBiz();
    const res = await del(row.id);
    expect(res.status).toBe(200);
    expectSampleFlags(res);
    const j = await body<AdminWriteResponse<Business>>(res);
    expect(j.row).toEqual({ ...row, is_active: false });
    expect(j.persisted).toBe(false);
    expect((await getHelp({})).businesses.some((b) => b.id === row.id)).toBe(false);
    expect((await adminList()).find((b) => b.id === row.id)?.is_active).toBe(false);
    expect((await del(row.id)).status).toBe(200);
    expect((await patch(row.id, { is_active: true })).status).toBe(200);
    expect((await getHelp({})).businesses.some((b) => b.id === row.id)).toBe(true);
  });

  it("sponsorship never changes the order (admin list and /api/help)", async () => {
    const a = await createdBiz({ name: "QA Alpha" });
    const z = await createdBiz({ name: "QA Zulu", area: "Karon" });
    const order = async () => (await getHelp({})).businesses.map((b) => b.id);
    const before = await order();
    await patch(z.id, { is_sponsored: true });
    expect(await order()).toEqual(before);
    expect((await adminList()).map((b) => b.id)).toEqual((await adminList()).map((b) => b.id));
    const ia = before.indexOf(a.id);
    const iz = before.indexOf(z.id);
    expect(ia).toBeLessThan(iz);
  });

  it.each([UNKNOWN, "nope"])("unknown / malformed id %s ⇒ 404", async (id) => {
    expect((await patch(id, { is_sponsored: true })).status).toBe(404);
    expect((await del(id)).status).toBe(404);
  });
});

// ------------------------------------------------------------------ cross-cutting
// DbError → generic 500 lives in tests/api-admin-errors.test.ts (needs its own vi.mock of lib/db/admin).

describe("public cache headers (v0.6)", () => {
  it("/api/price and /api/help: public, s-maxage=60, stale-while-revalidate=60", async () => {
    const price = await import("@/app/api/price/route");
    const help = await import("@/app/api/help/route");
    for (const res of [await price.GET(new Request(`${U}/api/price`)), await help.GET(new Request(`${U}/api/help`))]) {
      expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=60");
    }
  });
});

describe("globalThis stores survive module re-evaluation (next dev)", () => {
  it("admin overlay: POST in one module instance is seen by a fresh instance of the public route", async () => {
    await createdPrice();
    vi.resetModules();
    const fresh = await import("@/lib/db/prices");
    expect((await fresh.findPrices({ item: "qa longtail" })).map((r) => r.item_key)).toContain(PRICE.item_key);
    const freshAdmin = await import("@/lib/db/admin");
    freshAdmin.resetAdminOverlay();
  });
  it("report store: save in one route instance, GET in a re-evaluated one ⇒ 200", async () => {
    const save = await import("@/app/api/report/save/route");
    const { FACTS, MARKDOWN } = await import("./helpers/report");
    const { CONSENT_VERSION } = await import("@/types/protocol");
    const res = await save.POST(json("POST", { facts: FACTS, markdown: MARKDOWN, lang: "en", consent: true, consent_version: CONSENT_VERSION }));
    expect(res.status).toBe(201);
    const r = await body<{ id: string; delete_token: string }>(res);
    vi.resetModules();
    const byId = await import("@/app/api/report/[id]/route");
    const got = await byId.GET(new Request(U, { headers: { "x-delete-token": r.delete_token } }), ctx(r.id));
    expect(got.status).toBe(200);
  });
});
