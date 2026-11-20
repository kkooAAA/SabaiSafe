// Admin routes map lib/db failures to the contract errors without leaking Postgres text or secrets (§3, §3.9).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DbError, DbUnavailableError } from "@/lib/db/errors";

const LEAK = 'duplicate key value violates unique constraint "prices_pkey" SUPABASE_SERVICE_ROLE_KEY=abc';
vi.mock("@/lib/db/admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/admin")>();
  const fail = vi.fn(async () => {
    throw new DbError(LEAK, { cause: new Error("pg detail: row 42") });
  });
  return {
    ...actual,
    listAdminPrices: fail,
    createAdminPrice: fail,
    updateAdminPrice: fail,
    deleteAdminPrice: fail,
    listAdminBusinesses: fail,
    createAdminBusiness: fail,
    updateAdminBusiness: fail,
    deleteAdminBusiness: fail,
  };
});
const admin = await import("@/lib/db/admin");
const prices = await import("@/app/api/admin/prices/route");
const priceId = await import("@/app/api/admin/prices/[id]/route");
const biz = await import("@/app/api/admin/businesses/route");
const bizId = await import("@/app/api/admin/businesses/[id]/route");

const U = "http://localhost";
const ID = "6f1c0a8e-0d4b-4a59-9b8e-3a1f2c3d4e5f";
const ctx = { params: Promise.resolve({ id: ID }) };
const j = (method: string, body: unknown) =>
  new Request(U, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const calls: [string, () => Promise<Response>][] = [
  ["GET prices", () => prices.GET(new Request(U))],
  ["POST prices", () => prices.POST(j("POST", { item_key: "x" }))],
  ["PATCH price", () => priceId.PATCH(j("PATCH", { max_thb: 1 }), ctx)],
  ["DELETE price", () => priceId.DELETE(new Request(U, { method: "DELETE" }), ctx)],
  ["GET businesses", () => biz.GET(new Request(U))],
  ["POST businesses", () => biz.POST(j("POST", { name: "x" }))],
  ["PATCH business", () => bizId.PATCH(j("PATCH", { is_sponsored: true }), ctx)],
  ["DELETE business", () => bizId.DELETE(new Request(U, { method: "DELETE" }), ctx)],
];

afterEach(() => vi.restoreAllMocks());

describe("DbError ⇒ 500 internal, generic body", () => {
  it.each(calls)("%s", async (_n, call) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    // Validation may reject the tiny bodies first (400) — that's fine; it must never echo the DB text.
    const text = await res.text();
    expect(text).not.toMatch(/duplicate key|prices_pkey|SERVICE_ROLE|pg detail|row 42/);
    if (res.status !== 400) {
      expect(res.status).toBe(500);
      expect(JSON.parse(text).error.code).toBe("internal");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    err.mockRestore();
  });
  it("GET (no body to validate) really reaches lib/db and returns 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await prices.GET(new Request(U))).status).toBe(500);
    expect(admin.listAdminPrices).toHaveBeenCalled();
  });
});

describe("DbUnavailableError ⇒ 503 unavailable", () => {
  it("GET prices", async () => {
    vi.mocked(admin.listAdminPrices).mockRejectedValueOnce(new DbUnavailableError("no service key"));
    const res = await prices.GET(new Request(U));
    expect(res.status).toBe(503);
    const t = await res.text();
    expect(JSON.parse(t).error.code).toBe("unavailable");
    expect(t).not.toContain("service key");
  });
});
