// GET /api/price?item=&area= — Fair Price reference rows. Owner: backend. Contracts v0.2 §3.6.
// Rate limiting is done in middleware.ts.
import { z } from "zod";
import { dbErrorResponse, errorResponse } from "@/lib/db/http";
import { findPrices } from "@/lib/db/prices";
import type { PriceResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  item: z.string().trim().max(200).optional(),
  area: z.string().trim().max(100).optional(),
});

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const q = Query.safeParse({ item: params.get("item") ?? undefined, area: params.get("area") ?? undefined });
  if (!q.success) return errorResponse(400, "bad_request", "item must be at most 200 characters and area at most 100.");

  try {
    const body: PriceResponse = { results: await findPrices(q.data) };
    return Response.json(body, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
