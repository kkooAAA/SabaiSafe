import { beforeEach, describe, expect, it } from "vitest";
import { isAiRoute, isLimited, rateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("rateLimit (fixed window)", () => {
  beforeEach(() => resetRateLimits());

  it("allows `limit` requests, then blocks until the window resets", () => {
    const t = 1_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000, t + i).ok).toBe(true);
    const blocked = rateLimit("k", 3, 60_000, t + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBe(t + 60_000);
    expect(rateLimit("k", 3, 60_000, t + 60_000).ok).toBe(true); // resetAt <= now ⇒ new window
  });

  it("reports remaining correctly", () => {
    expect(rateLimit("r", 5, 60_000, 0).remaining).toBe(4);
    expect(rateLimit("r", 5, 60_000, 1).remaining).toBe(3);
  });

  it("keeps keys independent", () => {
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000, 0).ok).toBe(true);
  });

  it("evicts expired buckets when the map grows past 10k, without losing live ones", () => {
    for (let i = 0; i < 10_001; i++) rateLimit(`old${i}`, 1, 10, 0);
    rateLimit("live", 1, 60_000, 0);
    rateLimit("trigger", 1, 60_000, 100); // new bucket at t=100 ⇒ eviction pass
    expect(rateLimit("live", 1, 60_000, 100).ok).toBe(false); // still counted
    expect(rateLimit("old0", 1, 10, 100).ok).toBe(true); // was evicted / expired
  });
});

describe("isLimited (peek)", () => {
  beforeEach(() => resetRateLimits());

  it("does not count a request", () => {
    for (let i = 0; i < 5; i++) expect(isLimited("p", 1, 0)).toBe(false);
    expect(rateLimit("p", 1, 60_000, 0).ok).toBe(true);
  });

  it("is true once count reaches the limit, false after the window", () => {
    rateLimit("p", 2, 60_000, 0);
    expect(isLimited("p", 2, 1)).toBe(false);
    rateLimit("p", 2, 60_000, 2);
    expect(isLimited("p", 2, 3)).toBe(true);
    expect(isLimited("p", 2, 60_000)).toBe(false);
  });
});

describe("isAiRoute", () => {
  it.each(["/api/chat", "/api/chat/price", "/api/report/chat", "/api/report/generate", "/api/report/pdf", "/api/report/save", "/api/report/abc"])(
    "%s is an AI route",
    (p) => expect(isAiRoute(p)).toBe(true),
  );
  it.each(["/api/price", "/api/help", "/api/admin/prices", "/en/report"])("%s is not", (p) => expect(isAiRoute(p)).toBe(false));
});
