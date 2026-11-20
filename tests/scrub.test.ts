// PDPA: passport and phone numbers never reach stored reports (contracts §2.6, §3.3, v0.2 scrub spec).
import { describe, expect, it } from "vitest";
import { REDACTED, scrubDeep, scrubPassport, scrubPhone, scrubPII } from "@/lib/ai/scrub";

describe("scrubPassport", () => {
  it.each([
    ["passport no. AB1234567", "AB1234567"],
    ["my passport number: E12345678", "E12345678"],
    ["passport 123456789", "123456789"], // US-style, digits only
    ["Passport #X1234567", "X1234567"],
    ["passport ab1234567", "ab1234567"], // lowercase
    ["护照号码E12345678", "E12345678"],
    ["护照号 EA1234567", "EA1234567"],
    ["หนังสือเดินทางเลขที่ AA1234567", "AA1234567"],
    ["he copied G12345678 from my bag", "G12345678"], // token without keyword
  ])("redacts the number in %j", (input, secret) => {
    const out = scrubPassport(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it.each([
    "they kept my passport as deposit",
    "The shop kept my passport deposit until I paid",
    "他们扣了我的护照作押金",
    "passport held for 3 days",
    "Paid 5,000 baht, then 50000 THB more",
    "Call Tourist Police 1155",
  ])("keeps %j word for word", (s) => expect(scrubPassport(s)).toBe(s));

  // Known gaps we want closed (fail = leak). Free text often puts a verb between the keyword and the number.
  it.each([
    ["my passport number is 123456789", "123456789"],
    ["护照号码是123456789", "123456789"],
    ["passport no. is 987654321", "987654321"],
  ])("redacts a bare 9-digit number after 'passport ... is' in %j", (input, secret) => {
    expect(scrubPassport(input)).not.toContain(secret);
  });
});

describe("scrubPhone", () => {
  it.each([
    ["call me 081-234-5678", "081-234-5678"],
    ["0812345678", "0812345678"],
    ["+66 81 234 5678", "+66 81 234 5678"],
    ["66812345678", "66812345678"],
    ["shop phone 076-123-456", "076-123-456"],
    ["02 123 4567", "02 123 4567"],
    ["+86 138 0013 8000", "+86 138 0013 8000"],
    ["+44 20 7946 0958", "+44 20 7946 0958"],
  ])("redacts %j", (input, secret) => {
    const out = scrubPhone(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("redacts a Chinese mobile written without +86 (main audience)", () => {
    expect(scrubPhone("我的电话13800138000")).not.toContain("13800138000");
    expect(scrubPhone("call 138 0013 8000")).not.toContain("138 0013 8000");
  });

  it.each([
    "Call 1155, 191, 1669 or 1166",
    "He asked for 5,000 baht",
    "I paid 50000 THB",
    "on 2026-11-15 at 21:30",
    "plate กข 1234 ภูเก็ต",
    "Land Transport Act B.E. 2522",
  ])("keeps %j", (s) => expect(scrubPhone(s)).toBe(s));
});

describe("scrubEmail (via scrubPII)", () => {
  it.each([
    ["email me at john.doe@example.com please", "email me at [REDACTED] please"],
    ["我的邮箱是zhang.wei88@qq.com，谢谢", "我的邮箱是[REDACTED]，谢谢"],
    ["write to anna+phuket@gmail.co.uk now", "write to [REDACTED] now"],
    ["contact: Mai_99@hotmail.com.", "contact: [REDACTED]."],
  ])("%j", (input, want) => expect(scrubPII(input)).toBe(want));

  it.each(["user@localhost no tld", "kept my passport, call 1155, paid 5,000 baht", "@tourist_police on LINE"])(
    "keeps %j",
    (s) => expect(scrubPII(s)).toBe(s),
  );
});

describe("scrubPII / scrubDeep", () => {
  it("scrubs both kinds in one string", () => {
    const out = scrubPII("passport AB1234567, phone 081-234-5678, kept my passport");
    expect(out).not.toMatch(/AB1234567|081-234-5678/);
    expect(out).toContain("kept my passport");
  });

  it("walks nested objects and arrays without mutating the input", () => {
    const input = {
      incident_summary_en: "Driver took passport E12345678",
      parties: [{ description: "phone 0812345678", name: null }],
      money: { amount: 5000, currency: "THB" },
      evidence: ["receipt", "+66 81 234 5678"],
    };
    const copy = structuredClone(input);
    const out = scrubDeep(input);
    expect(input).toEqual(copy);
    expect(JSON.stringify(out)).not.toMatch(/E12345678|0812345678|81 234 5678/);
    expect(out.money).toEqual({ amount: 5000, currency: "THB" });
    expect(out.parties[0]?.name).toBeNull();
  });

  it("is idempotent", () => {
    const s = "passport AB1234567 call 081-234-5678";
    expect(scrubPII(scrubPII(s))).toBe(scrubPII(s));
  });
});
