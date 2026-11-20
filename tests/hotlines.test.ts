import { describe, expect, it } from "vitest";
import { HOTLINES, HOTLINE_NUMBERS } from "@/lib/hotlines";

describe("hotlines (CLAUDE.md non-negotiable rule)", () => {
  it("are exactly 1155, 191, 1669, 1166", () => {
    expect([...HOTLINE_NUMBERS].sort()).toEqual(["1155", "1166", "1669", "191"]);
  });

  it("map each number to the right service", () => {
    const byKey = Object.fromEntries(HOTLINES.map((h) => [h.key, h.number]));
    expect(byKey).toEqual({ tourist_police: "1155", police: "191", ambulance: "1669", consumer: "1166" });
  });

  it("have en, zh and th names", () => {
    for (const h of HOTLINES) {
      expect(h.name_en.length).toBeGreaterThan(0);
      expect(h.name_zh).toMatch(/[一-鿿]/);
      expect(h.name_th).toMatch(/[฀-๿]/);
    }
  });
});
