// POST /api/report/save, GET/DELETE /api/report/:id (contracts §3.5, §3.5a, §2.6) — PDPA paths.
// consent must be literal true; consent_version exact; client data re-scrubbed; token-only access; all failures are
// one indistinguishable 404; a missing header never touches lib/db.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError, ReportSaveResponse } from "@/types/api";
import { CONSENT_VERSION } from "@/types/protocol";
import { DbError, DbUnavailableError } from "@/lib/db/errors";
import { FACTS, MARKDOWN, PII, jsonOf, jsonRequest, leakedPii } from "./helpers/report";

// Wrap backend's store in spies (real in-memory behaviour, but we can see calls and inject failures).
vi.mock("@/lib/db/reports", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/reports")>();
  return {
    ...actual,
    saveReport: vi.fn(actual.saveReport),
    getReport: vi.fn(actual.getReport),
    deleteReport: vi.fn(actual.deleteReport),
  };
});
const db = await import("@/lib/db/reports");
const save = await import("@/app/api/report/save/route");
const byId = await import("@/app/api/report/[id]/route");

const DAY = 24 * 60 * 60 * 1000;
const UNKNOWN_ID = "00000000-0000-4000-a000-000000000000";
const VALID = { facts: FACTS, markdown: MARKDOWN, lang: "en", consent: true, consent_version: CONSENT_VERSION };

const postSave = (body: unknown) => save.POST(jsonRequest("http://localhost/api/report/save", body));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const idReq = (id: string, method: "GET" | "DELETE", token?: string) =>
  new Request(`http://localhost/api/report/${encodeURIComponent(id)}`, {
    method,
    headers: token === undefined ? {} : { "x-delete-token": token },
  });
const get = (id: string, token?: string) => byId.GET(idReq(id, "GET", token), ctx(id));
const del = (id: string, token?: string) => byId.DELETE(idReq(id, "DELETE", token), ctx(id));

async function saved(body: unknown = VALID): Promise<ReportSaveResponse> {
  const res = await postSave(body);
  expect(res.status).toBe(201);
  return jsonOf<ReportSaveResponse>(res);
}

beforeEach(() => {
  db.resetMemoryReports();
  vi.mocked(db.saveReport).mockClear();
  vi.mocked(db.getReport).mockClear();
  vi.mocked(db.deleteReport).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/report/save", () => {
  it("declares the node runtime", () => expect(save.runtime).toBe("nodejs"));

  it("201 {id, expires_at, delete_token}: uuid, +30 days, 32 random bytes base64url", async () => {
    const before = Date.now();
    const r = await saved();
    expect(Object.keys(r).sort()).toEqual(["delete_token", "expires_at", "id"]);
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(r.delete_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(r.delete_token, "base64url")).toHaveLength(32);
    const exp = Date.parse(r.expires_at);
    expect(new Date(exp).toISOString()).toBe(r.expires_at);
    expect(exp - before).toBeGreaterThanOrEqual(30 * DAY - 5000);
    expect(exp - before).toBeLessThanOrEqual(30 * DAY + 5000);
    expect((await saved()).delete_token).not.toBe(r.delete_token);
  });

  it.each([
    ["consent missing", { ...VALID, consent: undefined }],
    ["consent false", { ...VALID, consent: false }],
    ['consent "true"', { ...VALID, consent: "true" }],
    ["consent 1", { ...VALID, consent: 1 }],
    ["consent null", { ...VALID, consent: null }],
    ["consent {}", { ...VALID, consent: {} }],
  ])("%s ⇒ 400 consent_required, nothing saved", async (_n, body) => {
    const res = await postSave(body);
    expect(res.status).toBe(400);
    expect((await jsonOf<ApiError>(res)).error.code).toBe("consent_required");
    expect(db.saveReport).not.toHaveBeenCalled();
    expect(db.memoryReportCount()).toBe(0);
  });

  it.each([
    ["old version", { ...VALID, consent_version: "2026-10-v0" }],
    ["missing version", { ...VALID, consent_version: undefined }],
    ["version with spaces", { ...VALID, consent_version: ` ${CONSENT_VERSION} ` }],
  ])("%s ⇒ 400 consent_outdated, nothing saved", async (_n, body) => {
    const res = await postSave(body);
    expect(res.status).toBe(400);
    expect((await jsonOf<ApiError>(res)).error.code).toBe("consent_outdated");
    expect(db.saveReport).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["missing facts", { ...VALID, facts: undefined }],
    ["facts with a passport field smuggled in a wrong shape", { ...VALID, facts: { ...FACTS, incident_type: "passport" } }],
    ["empty markdown", { ...VALID, markdown: "" }],
    ["markdown too long", { ...VALID, markdown: "x".repeat(20001) }],
    ["lang th", { ...VALID, lang: "th" }],
  ])("%s ⇒ 400 bad_request", async (_n, body) => {
    const res = await postSave(body);
    expect(res.status).toBe(400);
    expect((await jsonOf<ApiError>(res)).error.code).toBe("bad_request");
    expect(db.saveReport).not.toHaveBeenCalled();
  });

  it("client-sent facts/markdown are re-scrubbed; hotlines, amounts and the fact are kept", async () => {
    const md = `${MARKDOWN}\nPassport ${PII.passportToken}, phone ${PII.thaiMobile}, ${PII.email}. Called 1155, 191, 1669, 1166. Paid 5,000 baht.`;
    const r = await saved({ ...VALID, markdown: md });
    // what the route handed to lib/db is already scrubbed (route scrubs, not only saveReport)
    const arg = vi.mocked(db.saveReport).mock.calls[0]![0];
    expect(leakedPii(JSON.stringify(arg))).toEqual([]);
    const back = await jsonOf<{ facts: typeof FACTS; markdown: string }>(await get(r.id, r.delete_token));
    expect(leakedPii(JSON.stringify(back))).toEqual([]);
    for (const k of ["1155", "191", "1669", "1166", "5,000 baht"]) expect(back.markdown).toContain(k);
    expect(back.facts.incident_summary_en).toContain("kept my passport");
    expect(back.facts.money.amount).toBe(5000);
  });

  it("unknown extra keys (e.g. a passport_number) are not stored", async () => {
    const r = await saved({ ...VALID, facts: { ...FACTS, passport_number: PII.passportToken }, ip: "1.2.3.4" });
    const back = await jsonOf<{ facts: Record<string, unknown> }>(await get(r.id, r.delete_token));
    expect(JSON.stringify(back)).not.toContain(PII.passportToken);
    expect(back.facts).not.toHaveProperty("passport_number");
  });

  it("sample mode without SAMPLE_REPORTS_IN_MEMORY ⇒ 503 unavailable", async () => {
    vi.stubEnv("SAMPLE_REPORTS_IN_MEMORY", "");
    const res = await postSave(VALID);
    expect(res.status).toBe(503);
    expect((await jsonOf<ApiError>(res)).error.code).toBe("unavailable");
  });

  it("DbError ⇒ 500 internal without internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.saveReport).mockRejectedValueOnce(new DbError("relation reports does not exist"));
    const res = await postSave(VALID);
    expect(res.status).toBe(500);
    const j = await jsonOf<ApiError>(res);
    expect(j.error.code).toBe("internal");
    expect(j.error.message).not.toMatch(/relation|reports does not/);
    spy.mockRestore();
  });
});

describe("GET / DELETE /api/report/:id", () => {
  it("declares the node runtime", () => expect(byId.runtime).toBe("nodejs"));

  it("GET with the right token ⇒ 200 {facts, markdown, expires_at}", async () => {
    const r = await saved();
    const res = await get(r.id, r.delete_token);
    expect(res.status).toBe(200);
    const j = await jsonOf<Record<string, unknown>>(res);
    expect(Object.keys(j).sort()).toEqual(["expires_at", "facts", "markdown"]);
    expect(j.expires_at).toBe(r.expires_at);
    expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
  });

  it.each(["GET", "DELETE"] as const)("%s without the header ⇒ 404 and lib/db is never called", async (m) => {
    const r = await saved();
    const res = m === "GET" ? await get(r.id) : await del(r.id);
    expect(res.status).toBe(404);
    expect((await jsonOf<ApiError>(res)).error.code).toBe("not_found");
    expect(db.getReport).not.toHaveBeenCalled();
    expect(db.deleteReport).not.toHaveBeenCalled();
  });

  it.each(["GET", "DELETE"] as const)("%s: wrong token / unknown id / malformed id / empty token / expired all give the same 404", async (m) => {
    const r = await saved();
    const call = (id: string, t?: string) => (m === "GET" ? get(id, t) : del(id, t));
    const cases: Response[] = [
      await call(r.id, "x".repeat(43)),
      await call(r.id, r.delete_token.slice(0, -1) + (r.delete_token.endsWith("A") ? "B" : "A")),
      await call(UNKNOWN_ID, r.delete_token),
      await call("not-a-uuid", r.delete_token),
      await call("../../etc/passwd", r.delete_token),
      await call(r.id, ""),
    ];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 30 * DAY + 60_000);
    cases.push(await call(r.id, r.delete_token)); // expired
    vi.useRealTimers();

    const bodies = await Promise.all(cases.map(async (res) => ({ status: res.status, body: await res.text() })));
    for (const b of bodies) expect(b.status).toBe(404);
    expect(new Set(bodies.map((b) => b.body)).size).toBe(1);
    expect((JSON.parse(bodies[0]!.body) as ApiError).error.code).toBe("not_found");
    // still there for the owner (nothing above deleted it), before expiry
    expect((await get(r.id, r.delete_token)).status).toBe(200);
  });

  it("DELETE ⇒ 204 empty body; then GET ⇒ 404 and a second DELETE ⇒ 404", async () => {
    const r = await saved();
    const res = await del(r.id, r.delete_token);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(db.memoryReportCount()).toBe(0);
    expect((await get(r.id, r.delete_token)).status).toBe(404);
    expect((await del(r.id, r.delete_token)).status).toBe(404);
  });

  it("one report's token cannot read or delete another report", async () => {
    const r1 = await saved();
    const r2 = await saved();
    expect((await get(r1.id, r2.delete_token)).status).toBe(404);
    expect((await del(r1.id, r2.delete_token)).status).toBe(404);
    expect((await get(r1.id, r1.delete_token)).status).toBe(200);
  });

  it("DbUnavailableError ⇒ 503, DbError ⇒ 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.getReport).mockRejectedValueOnce(new DbUnavailableError());
    expect((await get(UNKNOWN_ID, "t".repeat(43))).status).toBe(503);
    vi.mocked(db.deleteReport).mockRejectedValueOnce(new DbError("boom"));
    const res = await del(UNKNOWN_ID, "t".repeat(43));
    expect(res.status).toBe(500);
    expect((await jsonOf<ApiError>(res)).error.code).toBe("internal");
    spy.mockRestore();
  });
});
