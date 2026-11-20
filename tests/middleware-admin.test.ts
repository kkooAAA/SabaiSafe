// Admin auth through middleware for every admin path / method (contracts §1, §3.9), including path-variant
// bypass attempts. Complements tests/middleware.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import middleware, { isAdminPath } from "@/middleware";
import { isAiRoute, resetRateLimits } from "@/lib/rate-limit";

const BASE = "http://localhost:3000";
const PASS = "corr3ct-horse:battery";
const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;
const req = (path: string, method = "GET", headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, BASE), { method, headers });

const API_PATHS = [
  "/api/admin/prices",
  "/api/admin/prices/6f1c0a8e-0d4b-4a59-9b8e-3a1f2c3d4e5f",
  "/api/admin/businesses",
  "/api/admin/businesses/6f1c0a8e-0d4b-4a59-9b8e-3a1f2c3d4e5f",
  "/api/admin",
  "/api/admin/",
];
const PAGE_PATHS = ["/en/admin", "/zh/admin", "/en/admin/", "/zh/admin/prices", "/en/admin/businesses"];
const METHODS = ["GET", "POST", "PATCH", "DELETE", "PUT", "HEAD", "OPTIONS"];

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("ADMIN_PASSWORD", PASS);
});
afterEach(() => vi.unstubAllEnvs());

describe("every admin API path and method is guarded", () => {
  for (const p of API_PATHS) {
    it.each(METHODS)(`%s ${p}: no creds ⇒ 401 JSON + WWW-Authenticate; right creds ⇒ through`, async (m) => {
      const denied = middleware(req(p, m, { "x-real-ip": `10.0.${API_PATHS.indexOf(p)}.1` }));
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toBe('Basic realm="SabaiSafe admin"');
      if (m !== "HEAD") expect(await denied.json()).toMatchObject({ error: { code: "unauthorized" } });
      const ok = middleware(req(p, m, { authorization: basic("admin", PASS) }));
      expect(ok.status).not.toBe(401);
      expect(ok.status).not.toBe(503);
    });
  }

  it.each(API_PATHS)("%s without ADMIN_PASSWORD ⇒ 503 unavailable, even with credentials", async (p) => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    const res = middleware(req(p, "POST", { authorization: basic("admin", "") }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "unavailable" } });
  });
});

describe("admin pages are guarded in both locales", () => {
  it.each(PAGE_PATHS)("%s: 401 (plain text) without creds, through with creds", async (p) => {
    const res = middleware(req(p));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Basic /);
    expect(await res.text()).not.toMatch(/<html/i); // no page content leaks
    expect(middleware(req(p, "GET", { authorization: basic("admin", PASS) })).status).not.toBe(401);
  });
  it.each(PAGE_PATHS)("%s without ADMIN_PASSWORD ⇒ 503", (p) => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(middleware(req(p)).status).toBe(503);
  });
  it("the unprefixed /admin is redirected to a locale (and then guarded there), never served", () => {
    const res = middleware(req("/admin"));
    expect([307, 308, 401]).toContain(res.status);
    if (res.status !== 401) expect(res.headers.get("location")).toMatch(/\/en\/admin$/);
  });
});

describe("credential edge cases", () => {
  it.each([
    ["wrong user", basic("Admin", PASS)],
    ["user with spaces", basic(" admin", PASS)],
    ["password prefix", basic("admin", PASS.slice(0, -1))],
    ["password with extra char", basic("admin", PASS + "x")],
    ["empty password", basic("admin", "")],
    ["Bearer scheme", `Bearer ${PASS}`],
    ["lowercase scheme", `basic ${btoa(`admin:${PASS}`)}`],
    ["no colon", `Basic ${btoa("admin")}`],
    ["garbage", "Basic !!!"],
  ])("%s ⇒ 401", (_n, auth) => expect(middleware(req("/api/admin/prices", "GET", { authorization: auth })).status).toBe(401));
});

describe("lockout", () => {
  it("10 failures ⇒ 429 for every admin path from that IP (checked before the password)", async () => {
    const ip = { "x-real-ip": "203.0.113.9" };
    for (let i = 0; i < 10; i++) middleware(req("/api/admin/prices", "POST", { ...ip, authorization: basic("admin", `nope${i}`) }));
    for (const p of [...API_PATHS, ...PAGE_PATHS]) {
      const res = middleware(req(p, "GET", { ...ip, authorization: basic("admin", PASS) }));
      expect(res.status, p).toBe(429);
    }
  });
  it("requests WITHOUT credentials don't count as failures (a crawler can't lock the admin out)", () => {
    const ip = { "x-real-ip": "203.0.113.10" };
    for (let i = 0; i < 20; i++) expect(middleware(req("/en/admin", "GET", ip)).status).toBe(401);
    expect(middleware(req("/en/admin", "GET", { ...ip, authorization: basic("admin", PASS) })).status).not.toBe(401);
  });
});

describe("path classification", () => {
  it.each(["/api/admin", "/api/admin/prices", "/en/admin", "/zh/admin/x"])("%s is an admin path", (p) => expect(isAdminPath(p)).toBe(true));
  it.each(["/api/administrator", "/en/administer", "/api/price", "/en/help", "/apiadmin"])("%s is not", (p) =>
    expect(isAdminPath(p)).toBe(false),
  );
  it("admin API routes are in the data bucket, not the AI bucket", () => {
    expect(isAiRoute("/api/admin/prices")).toBe(false);
    expect(isAiRoute("/api/admin/businesses/x")).toBe(false);
  });
  // Percent-encoded paths: Next decodes them for routing. On next start qa saw /%65n/admin, /en/%61dmin and
  // /%7A%68/admin serve the admin console with 200 and no credentials. Middleware must decode before classifying.
  it.each(["/%65n/admin", "/%7A%68/admin", "/en/%61dmin", "/%65n/%61dmin", "/zh/%61dmin/prices", "/api/%61dmin/prices", "/api/admin%2Fprices"])(
    "%s without credentials ⇒ 401 (not served)",
    (p) => expect(middleware(req(p)).status).toBe(401),
  );
  it("a malformed escape does not crash middleware", () => expect(() => middleware(req("/en/%E0%A4%A"))).not.toThrow());
});
