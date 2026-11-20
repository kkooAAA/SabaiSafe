// PATCH/DELETE /api/admin/prices/:id. Owner: backend. Contracts §3.9. Auth: middleware (HTTP Basic).
// DELETE is a hard delete (204).
import { deleteAdminPrice, isPersisted, updateAdminPrice } from "@/lib/db/admin";
import type { AdminWriteResponse, PriceRef } from "@/types/api";
import { adminError, adminJson, adminNoContent, adminNotFound, readJson, revalidatePublicPages } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const parsed = await readJson(req);
  if (parsed instanceof Response) return parsed;
  try {
    const row = await updateAdminPrice(id, parsed.body);
    if (!row) return adminNotFound();
    revalidatePublicPages();
    const body: AdminWriteResponse<PriceRef> = { row, persisted: isPersisted() };
    return adminJson(body);
  } catch (err) {
    return adminError(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  try {
    if (!(await deleteAdminPrice(id))) return adminNotFound();
    revalidatePublicPages();
    return adminNoContent();
  } catch (err) {
    return adminError(err);
  }
}
