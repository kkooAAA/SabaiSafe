// POST /api/report/chat: Report Assistant interview (contracts §3.2). Streamed text/plain; "\n[READY]" only as final bytes.
import { ReportChatRequest } from "@/types/api";
import { errorResponse, jsonError, parseBody } from "@/lib/ai/http";
import { interviewResponse, startsAndEndsWithUser } from "@/lib/ai/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await parseBody(req, ReportChatRequest);
  if (!body.ok) return body.response;
  if (!startsAndEndsWithUser(body.data.messages)) {
    return jsonError(400, "bad_request", "messages: the first and last message must be from the user.");
  }
  try {
    return interviewResponse(body.data.messages, body.data.lang, req.signal);
  } catch (err) {
    return errorResponse(err);
  }
}
