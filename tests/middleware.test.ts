import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import middleware, { clientIp, config, envLimit, isAdminPath, parseBasicAuth } from "@/middleware";
import { resetRateLimits } from "@/lib/rate-limit";

const BASE = "http://localhost:3000";

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, BASE), { headers });
}

function basic(user: string, pass: string) {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

/** The page matcher, compiled the way Next does for a regex-group pattern: anchored, whole path. */
function pageMatcher(): RegExp {
  const pattern = config.matcher.find((m) => m.startsWith("/(("));
  if (!pattern) throw new Error("page matcher missing");
  return new RegExp(`^${pattern}$`);
}

describe("middleware config.matcher", () => {
  it("keeps a literal-dot escape (guards against the lost-backslash bug)", () => {
    const pattern = config.matcher.find((m) => m.startsWith("/((")) ?? "";
    expect(pattern).toContain("\\.");
  });

  it.each(["/", "/en", "/zh", "/en/admin", "/zh/admin/prices", "/legal", "/en/legal", "/en/price", "/apiguide"])(
    "runs on page path %s",
    (p) => expect(pageMatcher().test(p)).toBe(true),
  );

  it.each(["/favicon.ico", "/_next/static/x.js", "/_next/image", "/_vercel/insights", "/api/chat", "/api", "/robots.txt"])(
    "skips %s in the page matcher",
    (p) => expect(pageMatcher().test(p)).toBe(false),
  );

  it("has a separate matcher for all API routes", () => {
    expect(config.matcher).toContain("/api/:path*");
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip", () => {
    expect(clientIp(new Request(BASE, { headers: { "x-real-ip": " 1.1.1.1 ", "x-forwarded-for": "9.9.9.9" } }))).toBe(
      "1.1.1.1",
    );
  });
  it("uses the LAST x-forwarded-for entry (the one our proxy appended), not the spoofable first", () => {
    expect(clientIp(new Request(BASE, { headers: { "x-forwarded-for": "6.6.6.6, 2.2.2.2" } }))).toBe("2.2.2.2");
  });
  it("falls back to unknown", () => {
    expect(clientIp(new Request(BASE))).toBe("unknown");
  });
});

describe("isAdminPath", () => {
  it.each(["/api/admin", "/api/admin/prices", "/en/admin", "/zh/admin", "/en/admin/x"])("guards %s", (p) =>
    expect(isAdminPath(p)).toBe(true),
  );
  it.each(["/api/administrator", "/en/administrator", "/admin-tips", "/en/legal", "/fr/admin"])("does not guard %s", (p) =>
    expect(isAdminPath(p)).toBe(false),
  );
});

describe("envLimit", () => {
  it.each([
    [undefined, 15],
    ["", 15],
    ["abc", 15],
    ["0", 15],
    ["-3", 15],
    ["0.5", 15],
    ["Infinity", 15],
    ["30", 30],
    ["7.9", 7],
  ])("envLimit(%j, 15) = %d", (v, want) => expect(envLimit(v as string | undefined, 15)).toBe(want));
});

describe("parseBasicAuth", () => {
  it("parses user and a password containing colons", () => {
    expect(parseBasicAuth(basic("admin", "pa:ss:word"))).toEqual({ user: "admin", pass: "pa:ss:word" });
  });
  it.each([null, "", "Bearer abc", "Basic", "Basic !!!not-base64!!!", `Basic ${btoa("nocolon")}`])(
    "returns null for %j",
    (h) => expect(parseBasicAuth(h)).toBeNull(),
  );
});

describe("admin auth", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.stubEnv("ADMIN_PASSWORD", "s3cr:et");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns 503 when ADMIN_PASSWORD is unset", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    const res = middleware(req("/api/admin/prices"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "unavailable" } });
  });

  it("returns 401 JSON with WWW-Authenticate on the API without credentials", async () => {
    const res = middleware(req("/api/admin/prices"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic/);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("returns 401 on the admin page without credentials", () => {
    expect(middleware(req("/en/admin")).status).toBe(401);
  });

  it("rejects the wrong user and the wrong password", () => {
    expect(middleware(req("/en/admin", { authorization: basic("root", "s3cr:et") })).status).toBe(401);
    expect(middleware(req("/en/admin", { authorization: basic("admin", "s3cr") })).status).toBe(401);
  });

  it("lets the correct credentials through (password contains a colon)", () => {
    const res = middleware(req("/api/admin/prices", { authorization: basic("admin", "s3cr:et") }));
    expect(res.status).toBe(200);
  });

  it("does not crash on malformed base64", () => {
    expect(middleware(req("/en/admin", { authorization: "Basic %%%" })).status).toBe(401);
  });

  it("locks out an IP after 10 failures, even for the correct password", async () => {
    const ip = { "x-real-ip": "5.5.5.5" };
    for (let i = 0; i < 10; i++) {
      expect(middleware(req("/en/admin", { ...ip, authorization: basic("admin", `wrong${i}`) })).status).toBe(401);
    }
    const locked = middleware(req("/api/admin/prices", { ...ip, authorization: basic("admin", "s3cr:et") }));
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: { code: "rate_limited" } });
    // Another IP is unaffected.
    expect(middleware(req("/api/admin/prices", { "x-real-ip": "6.6.6.6", authorization: basic("admin", "s3cr:et") })).status).toBe(200);
  });
});

describe("API rate limit", () => {
  beforeEach(() => resetRateLimits());
  afterEach(() => vi.unstubAllEnvs());

  it("limits AI routes at RATE_LIMIT_AI_PER_MIN and returns a JSON 429 with Retry-After", async () => {
    vi.stubEnv("RATE_LIMIT_AI_PER_MIN", "3");
    const h = { "x-real-ip": "7.7.7.7" };
    for (let i = 0; i < 3; i++) expect(middleware(req("/api/chat", h)).status).toBe(200);
    const res = middleware(req("/api/report/chat", h)); // same AI bucket
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ error: { code: "rate_limited", message: expect.any(String) } });
  });

  it("keeps data routes in a separate, larger bucket", () => {
    vi.stubEnv("RATE_LIMIT_AI_PER_MIN", "1");
    vi.stubEnv("RATE_LIMIT_DATA_PER_MIN", "2");
    const h = { "x-real-ip": "8.8.8.8" };
    expect(middleware(req("/api/chat", h)).status).toBe(200);
    expect(middleware(req("/api/chat", h)).status).toBe(429);
    expect(middleware(req("/api/price", h)).status).toBe(200);
    expect(middleware(req("/api/help", h)).status).toBe(200);
    expect(middleware(req("/api/price", h)).status).toBe(429);
  });

  it("falls back to the default when the env var is blank (does not block everything)", () => {
    vi.stubEnv("RATE_LIMIT_DATA_PER_MIN", "");
    expect(middleware(req("/api/price", { "x-real-ip": "9.9.9.9" })).status).toBe(200);
  });

  it("cannot be bypassed by rotating the first x-forwarded-for entry", () => {
    vi.stubEnv("RATE_LIMIT_AI_PER_MIN", "1");
    expect(middleware(req("/api/chat", { "x-forwarded-for": "1.0.0.1, 10.0.0.1" })).status).toBe(200);
    expect(middleware(req("/api/chat", { "x-forwarded-for": "1.0.0.2, 10.0.0.1" })).status).toBe(429);
  });
});

describe("locale routing", () => {
  it("redirects an unprefixed page to the default locale", () => {
    const res = middleware(req("/legal"));
    expect([307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/en\/legal$/);
  });
});
