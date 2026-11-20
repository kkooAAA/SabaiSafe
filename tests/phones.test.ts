import { describe, expect, it } from "vitest";
import { findPhoneLike, inventedNumbers } from "./helpers/phones";

describe("phone-like detector (used by content tests and evals)", () => {
  it.each([
    ["call 081-234-5678 now", "0812345678"],
    ["+66 76 211 036", "6676211036"],
    ["(076) 123456", "076123456"],
    ["tel 076.211.036", "076211036"],
    ["+86 138 0013 8000", "8613800138000"],
  ])("flags %j", (text, digits) => expect(findPhoneLike(text)).toEqual([digits]));

  it.each([
    "Call 1155 or 191, ambulance 1669, OCPB 1166",
    "a fare of 5,000 baht or 12,500 THB",
    "Land Transport Act B.E. 2522 (1979)",
    "collected 2026-11-15",
    "section 34 and 35",
    "1,000,000 baht fine",
  ])("does not flag %j", (text) => expect(findPhoneLike(text)).toEqual([]));

  it("allows numbers present in the supplied sources", () => {
    expect(inventedNumbers("Call +66 76 211 036", ["Office: +66-76-211-036"])).toEqual([]);
    expect(inventedNumbers("Call 076 999 999", ["Office: +66-76-211-036"])).toEqual(["076999999"]);
  });
});
