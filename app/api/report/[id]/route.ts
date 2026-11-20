// GET / DELETE /api/report/:id with header x-delete-token (contracts §3.5a).
// Every failure is the same 404 not_found; a missing header never reaches the database.
import { errorResponse, jsonError } from "@/lib/ai/http";
import { deleteReport, getReport } from "@/lib/db/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => jsonError(404, "not_found", "Report not found.");

function token(req: Request): string | null {
  const t = req.headers.get("x-delete-token")?.trim();
  return t ? t : null;
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const t = token(req);
  if (!t) return notFound();
  const { id } = await ctx.params;
  try {
    const report = await getReport(id, t);
    if (!report) return notFound();
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const t = token(req);
  if (!t) return notFound();
  const { id } = await ctx.params;
  try {
    if (!(await deleteReport(id, t))) return notFound();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
