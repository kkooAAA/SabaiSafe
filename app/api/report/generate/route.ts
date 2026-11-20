// POST /api/report/generate: facts extraction + formal Thai summary (contracts §3.3). Nothing is stored.
import { ReportGenerateRequest } from "@/types/api";
import { errorResponse, jsonError, parseBody } from "@/lib/ai/http";
import { generateReport } from "@/lib/ai/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const body = await parseBody(req, ReportGenerateRequest);
  if (!body.ok) return body.response;
  // The last message may be the assistant's "[READY]" reply (the client sends the whole conversation).
  if (body.data.messages[0]?.role !== "user") {
    return jsonError(400, "bad_request", "messages: the first message must be from the user.");
  }
  try {
    const result = await generateReport(body.data.messages, req.signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
