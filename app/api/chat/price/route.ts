// POST /api/chat/price: Fair Price explanation (contracts §3.7). Streamed text/plain, no trailer.
import { PriceExplainRequest } from "@/types/api";
import { errorResponse, parseBody } from "@/lib/ai/http";
import { explainPrice } from "@/lib/ai/price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await parseBody(req, PriceExplainRequest);
  if (!body.ok) return body.response;
  try {
    return await explainPrice(body.data, req.signal);
  } catch (err) {
    return errorResponse(err);
  }
}
