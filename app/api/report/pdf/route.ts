// POST /api/report/pdf: the summary Markdown as an A4 PDF (contracts §3.4). Stateless; nothing is stored.
import { ReportPdfRequest } from "@/types/api";
import { errorResponse, parseBody } from "@/lib/ai/http";
import { scrubPII } from "@/lib/ai/scrub";
import { bangkokDateStamp, renderReportPdf } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await parseBody(req, ReportPdfRequest);
  if (!body.ok) return body.response;
  try {
    const pdf = await renderReportPdf(scrubPII(body.data.markdown));
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="sabaisafe-report-${bangkokDateStamp()}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
