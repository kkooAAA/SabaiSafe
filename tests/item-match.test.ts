// backend item matching (lib/db/query.ts normalizeItem): case, spaces, "-" and "_" are ignored. Real content/.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { filterPrices, normalizeItem } from "@/lib/db/query";
import { getSampleData, resetSampleCache } from "@/lib/db/sample";
import { GET } from "@/app/api/price/route";
import type { PriceResponse } from "@/types/api";

beforeAll(() => {
  vi.stubEnv("SAMPLE_DATA_DIR", "content");
  resetSampleCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetSampleCache();
});

const rows = () => getSampleData().prices;
const areas = (item: string, area?: string) => filterPrices(rows(), { item, area }).map((r) => r.area).sort();

describe("normalizeItem", () => {
  it("strips case, whitespace, - and _", () => expect(normalizeItem("Jet-Ski_ 30 min")).toBe("jetski30min"));
  it("keeps CJK", () => expect(normalizeItem("水上 摩托")).toBe("水上摩托"));
});

describe("item matching on real content", () => {
  it.each(["jetski", "jet-ski", "jet_ski", "Jet Ski", "JET  SKI", " jet ski rental ", "jetski_30min", "水上摩托", "水上 摩托"])(
    "%j finds both jet ski rows",
    (q) => expect(areas(q)).toEqual(["Kata", "Patong"]),
  );

  it("item + area narrows", () => expect(areas("Jet Ski", "Kata")).toEqual(["Kata"]));

  it.each(["---", "jet-ski-x"])("%j matches nothing (not 'no filter')", (q) => expect(filterPrices(rows(), { item: q })).toEqual([]));

  it("blank item still means all rows", () => expect(filterPrices(rows(), { item: "  " }).length).toBe(Math.min(rows().length, 100)));

  it("taxi in Kata ⇒ only island-wide rows, no duplicates", () => {
    const r = filterPrices(rows(), { item: "taxi", area: "Kata" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.area === "Phuket")).toBe(true);
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length);
  });

  it("GET /api/price?item=jetski returns rows", async () => {
    const body = (await (await GET(new Request("http://localhost/api/price?item=jetski"))).json()) as PriceResponse;
    expect(body.results.map((r) => r.item_key)).toEqual(["jetski_30min", "jetski_30min"]);
  });
});
