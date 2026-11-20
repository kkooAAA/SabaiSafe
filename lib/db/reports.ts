// Saved reports (PDPA). Owner: backend. Contracts v0.2 §2.6 / §3.5 / §3.5a / §4.
// - Stored only after explicit consent (checked by ai's route). No IP, UA, phone or passport number.
// - facts/markdown are scrubbed again here with lib/ai/scrub.ts (the client sends them back; never trust it).
// - A random delete token is returned once; only its sha256 is stored. Lookups compare in constant time.
// - Expired rows count as missing; expired rows are deleted on each insert (pg_cron does it daily too).
// - SAMPLE_REPORTS_IN_MEMORY=1 ⇒ in-memory store with identical behaviour (tests). Otherwise sample mode
//   throws DbUnavailableError (→ 503).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { scrubDeep, scrubPII } from "@/lib/ai/scrub";
import type { ReportFacts, ReportSaveResponse, UiLang } from "@/types/api";
import type { ReportInsert, StoredReport } from "@/types/db";
import { createServiceClient, isSampleMode } from "./client";
import { DbError, DbUnavailableError } from "./errors";

export const REPORT_TTL_DAYS = 30;
const TTL_MS = REPORT_TTL_DAYS * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export type SaveReportInput = { facts: ReportFacts; markdown: string; lang: UiLang; consent_version: string };
type Options = { now?: Date };

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Constant-time compare of sha256(token) with a stored hex hash. Always does the same work. */
function tokenMatches(token: string, storedHashHex: string | null): boolean {
  const a = Buffer.from(sha256Hex(token), "hex");
  const b = storedHashHex && /^[0-9a-f]{64}$/.test(storedHashHex) ? Buffer.from(storedHashHex, "hex") : Buffer.alloc(32);
  return timingSafeEqual(a, b) && storedHashHex !== null;
}

function inMemoryMode(): boolean {
  return process.env.SAMPLE_REPORTS_IN_MEMORY === "1";
}

// ---------------------------------------------------------------- in-memory store (tests)
type MemRow = ReportInsert & { id: string; consent_at: string; expires_at: string };
const mem = new Map<string, MemRow>();

function memPrune(now: Date): void {
  for (const [id, r] of mem) if (Date.parse(r.expires_at) < now.getTime()) mem.delete(id);
}

/** Tests only. */
export function resetMemoryReports(): void {
  mem.clear();
}
/** Tests only: number of rows in the in-memory store (to check prune-on-insert). */
export function memoryReportCount(): number {
  return mem.size;
}

// ---------------------------------------------------------------- API

export async function saveReport(input: SaveReportInput, opts: Options = {}): Promise<ReportSaveResponse> {
  const facts = scrubDeep(input.facts);
  const markdown = scrubPII(input.markdown);
  const delete_token = randomBytes(32).toString("base64url");
  const row: ReportInsert = {
    lang: input.lang,
    incident_type: facts.incident_type,
    facts,
    markdown,
    consent_version: input.consent_version,
    delete_token_hash: sha256Hex(delete_token),
  };

  if (inMemoryMode()) {
    const now = opts.now ?? new Date();
    memPrune(now);
    const id = randomUUID();
    const expires_at = new Date(now.getTime() + TTL_MS).toISOString();
    mem.set(id, { ...row, id, consent_at: now.toISOString(), expires_at });
    return { id, expires_at, delete_token };
  }
  if (isSampleMode()) throw new DbUnavailableError("Saving reports needs a database (sample mode)");

  const db = createServiceClient();
  // Fallback for pg_cron: delete expired rows on each insert.
  const prune = await db.from("reports").delete().lt("expires_at", new Date().toISOString());
  if (prune.error) throw new DbError("Failed to delete expired reports", { cause: prune.error });
  // consent_at / expires_at are set by SQL (defaults + trigger), never by the caller.
  const { data, error } = await db.from("reports").insert(row).select("id,expires_at").single();
  if (error || !data) throw new DbError("Failed to save report", { cause: error });
  return { id: data.id as string, expires_at: new Date(data.expires_at as string).toISOString(), delete_token };
}

type Lookup = { facts: ReportFacts; markdown: string; expires_at: string; delete_token_hash: string };

async function lookup(id: string, token: string, now: Date): Promise<Lookup | null> {
  const valid = UUID_RE.test(id) && TOKEN_RE.test(token);
  let row: Lookup | null = null;
  if (valid) {
    if (inMemoryMode()) {
      row = mem.get(id.toLowerCase()) ?? null;
    } else {
      if (isSampleMode()) throw new DbUnavailableError("Reports need a database (sample mode)");
      const { data, error } = await createServiceClient()
        .from("reports")
        .select("facts,markdown,expires_at,delete_token_hash")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new DbError("Failed to read report", { cause: error });
      row = (data as Lookup | null) ?? null;
    }
  }
  const ok = tokenMatches(valid ? token : "x", row?.delete_token_hash ?? null);
  if (!valid || !row || !ok || Date.parse(row.expires_at) < now.getTime()) return null;
  return row;
}

/** The saved report, or null for a wrong/malformed id, a wrong token, or an expired row (all the same). */
export async function getReport(id: string, token: string, opts: Options = {}): Promise<StoredReport | null> {
  const row = await lookup(id, token, opts.now ?? new Date());
  if (!row) return null;
  return { facts: row.facts, markdown: row.markdown, expires_at: new Date(row.expires_at).toISOString() };
}

/** Deletes the report. false for a wrong/malformed id, a wrong token, or an expired row (all the same). */
export async function deleteReport(id: string, token: string, opts: Options = {}): Promise<boolean> {
  const row = await lookup(id, token, opts.now ?? new Date());
  if (!row) return false;
  if (inMemoryMode()) return mem.delete(id.toLowerCase());
  const { error } = await createServiceClient().from("reports").delete().eq("id", id);
  if (error) throw new DbError("Failed to delete report", { cause: error });
  return true;
}
