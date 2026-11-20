// GET /api/help?category= — contacts (always incl. the four hotlines) and active businesses.
// Owner: backend. Contracts v0.2 §3.8. Rate limiting is done in middleware.ts.
import { HelpCategoryParam, getHelp } from "@/lib/db/help";
import { dbErrorResponse, errorResponse } from "@/lib/db/http";
import type { HelpResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("category")?.trim() || undefined;
  const category = raw === undefined ? undefined : HelpCategoryParam.safeParse(raw);
  if (category && !category.success) {
    return errorResponse(400, "bad_request", `Unknown category. Use one of: ${HelpCategoryParam.options.join(", ")}.`);
  }

  try {
    const body: HelpResponse = await getHelp({ category: category?.data });
    return Response.json(body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
