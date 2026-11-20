// POST /api/chat: Legal Guide (contracts §3.1). Streamed text/plain answer, then the SOURCES trailer.
import { ChatRequest } from "@/types/api";
import { errorResponse, parseBody } from "@/lib/ai/http";
import { answerLegal } from "@/lib/ai/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await parseBody(req, ChatRequest);
  if (!body.ok) return body.response;
  try {
    return await answerLegal(body.data, req.signal);
  } catch (err) {
    return errorResponse(err);
  }
}
