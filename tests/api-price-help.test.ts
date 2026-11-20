// GET /api/price and GET /api/help route handlers, called with a plain Request (sample mode, fixture data).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as priceGET } from "@/app/api/price/route";
import * as priceRoute from "@/app/api/price/route";
import { GET as helpGET } from "@/app/api/help/route";
import * as helpRoute from "@/app/api/help/route";
import { resetSampleCache } from "@/lib/db/sample";
import { HOTLINE_NUMBERS } from "@/lib/hotlines";
import type { ApiError, HelpResponse, PriceResponse } from "@/types/api";

const url = (p: string) => new Request(`http://localhost${p}`);

beforeAll(() => {
  vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/content");
  resetSampleCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetSampleCache();
});

describe("GET /api/price", () => {
  it("declares the node runtime", () => expect(priceRoute.runtime).toBe("nodejs"));

  it("no params ⇒ all rows, JSON PriceResponse", async () => {
    const res = await priceGET(url("/api/price"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as PriceResponse;
    expect(body.results).toHaveLength(6);
    const r = body.results[0]!;
    for (const k of ["id", "item_key", "item_name_en", "item_name_zh", "category", "area", "min_thb", "max_thb", "unit", "is_fixed_by_law", "source", "source_url", "collected_at", "notes", "is_sample"])
      expect(r, k).toHaveProperty(k);
    expect(typeof r.min_thb).toBe("number");
  });

  it("filters by item and area (island-wide included)", async () => {
    const body = (await (await priceGET(url("/api/price?item=tuk&area=kata"))).json()) as PriceResponse;
    expect(body.results.map((r) => `${r.item_key}@${r.area}`)).toEqual(["tuktuk_short@Kata"]);
    const a = (await (await priceGET(url("/api/price?area=Kata"))).json()) as PriceResponse;
    expect(a.results.some((r) => r.area === "Phuket")).toBe(true);
  });

  it("handles URL-encoded Chinese", async () => {
    const body = (await (await priceGET(url(`/api/price?item=${encodeURIComponent("瓶装水")}`))).json()) as PriceResponse;
    expect(body.results.map((r) => r.item_key)).toEqual(["water_bottle"]);
  });

  it.each([`/api/price?item=${"a".repeat(201)}`, `/api/price?area=${"a".repeat(101)}`])("400 bad_request for %s", async (p) => {
    const res = await priceGET(url(p));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error.code).toBe("bad_request");
  });

  it("returns 500 internal (contract error shape, no stack) when content is broken", async () => {
    vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/does-not-exist");
    resetSampleCache();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await priceGET(url("/api/price"));
    expect([500, 503]).toContain(res.status);
    const body = (await res.json()) as ApiError;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error.message).not.toMatch(/ENOENT|at .*\(|\\|\//);
    spy.mockRestore();
    vi.stubEnv("SAMPLE_DATA_DIR", "tests/fixtures/content");
    resetSampleCache();
  });
});

describe("GET /api/help", () => {
  it("declares the node runtime", () => expect(helpRoute.runtime).toBe("nodejs"));

  it("returns contacts incl. all four hotlines, and active businesses ordered by name", async () => {
    const res = await helpGET(url("/api/help"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as HelpResponse;
    for (const n of HOTLINE_NUMBERS) expect(body.contacts.filter((c) => c.phone === n)).toHaveLength(1);
    expect(body.businesses.map((b) => b.name)).toEqual(["[SAMPLE] Bravo Tours", "[SAMPLE] Yankee Rentals", "[SAMPLE] Zulu Rentals"]);
    expect(body.businesses.every((b) => b.is_active)).toBe(true);
  });

  it("filters by contact category", async () => {
    const body = (await (await helpGET(url("/api/help?category=police"))).json()) as HelpResponse;
    expect(body.contacts.every((c) => c.category === "police")).toBe(true);
    expect(body.contacts).toHaveLength(2);
  });

  it("filters by business category", async () => {
    const body = (await (await helpGET(url("/api/help?category=rental"))).json()) as HelpResponse;
    expect(body.businesses.map((b) => b.name)).toEqual(["[SAMPLE] Yankee Rentals", "[SAMPLE] Zulu Rentals"]);
  });

  it("emergency category returns the hotlines", async () => {
    const body = (await (await helpGET(url("/api/help?category=emergency"))).json()) as HelpResponse;
    expect(body.contacts.map((c) => c.phone).sort()).toEqual(["1155", "1669", "191"]);
  });

  it("400 for an unknown category", async () => {
    const res = await helpGET(url("/api/help?category=casino"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error.code).toBe("bad_request");
  });

  it("empty category = no filter", async () => {
    expect(((await (await helpGET(url("/api/help?category="))).json()) as HelpResponse).businesses).toHaveLength(3);
  });
});
