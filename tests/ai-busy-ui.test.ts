// components/shared/text-stream.ts aiErrorKey + the busy strings in both languages (AI routes answer 503 when busy).
import { describe, expect, it } from "vitest";
import { aiErrorKey } from "@/components/shared/text-stream";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

describe("aiErrorKey", () => {
  it.each([
    [503, "unavailable", "busy"],
    [503, null, "busy"],
    [200, "unavailable", "busy"],
    [429, "rate_limited", "rate_limited"],
    [429, null, "rate_limited"],
    [500, "internal", null],
    [400, "bad_request", null],
    [0, "network", null],
  ] as const)("(%i, %j) ⇒ %j", (status, code, want) => expect(aiErrorKey(status, code)).toBe(want));
});

describe("busy strings", () => {
  const get = (m: unknown, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);
  it.each(["errors.busy", "report.errors.busy", "price.check.retry"])("%s exists in en and zh, and differs", (p) => {
    const a = get(en, p);
    const b = get(zh, p);
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(a).not.toBe(b);
  });
  it("the busy text never names a provider or shows a phone number", () => {
    for (const s of [get(en, "errors.busy"), get(zh, "errors.busy"), get(en, "report.errors.busy"), get(zh, "report.errors.busy")])
      expect(String(s)).not.toMatch(/gemini|google|openai|anthropic|claude|\d{3,}/i);
  });
});
