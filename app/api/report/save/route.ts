// POST /api/report/save: store a report for 30 days, only with explicit consent (contracts §3.5, PDPA).
import { CONSENT_VERSION, ReportSaveRequest } from "@/types/api";
import { errorResponse, jsonError } from "@/lib/ai/http";
import { scrubDeep, scrubPII } from "@/lib/ai/scrub";
import { saveReport } from "@/lib/db/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Body must be valid JSON.");
  }
  const obj = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  // Consent is checked first and literally: only `true` counts.
  if (obj.consent !== true) return jsonError(400, "consent_required", "Explicit consent is required to save a report.");
  if (obj.consent_version !== CONSENT_VERSION) {
    return jsonError(400, "consent_outdated", "The consent text has changed. Please review and consent again.");
  }
  const parsed = ReportSaveRequest.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return jsonError(400, "bad_request", `${where}${first?.message ?? "Invalid request."}`);
  }
  const { facts, markdown, lang, consent_version } = parsed.data;
  try {
    // The client sends these back, so scrub again (saveReport scrubs a third time).
    const saved = await saveReport({ facts: scrubDeep(facts), markdown: scrubPII(markdown), lang, consent_version });
    return Response.json(saved, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
