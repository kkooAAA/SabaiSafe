// PATCH/DELETE /api/admin/businesses/:id. Owner: backend. Contracts §3.9. Auth: middleware (HTTP Basic).
// DELETE is a soft delete: is_active = false, 200 with the row. PATCH {is_active: true} re-activates.
import { deleteAdminBusiness, isPersisted, updateAdminBusiness } from "@/lib/db/admin";
import type { AdminWriteResponse, Business } from "@/types/api";
import { adminError, adminJson, adminNotFound, readJson, revalidatePublicPages } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const parsed = await readJson(req);
  if (parsed instanceof Response) return parsed;
  try {
    const row = await updateAdminBusiness(id, parsed.body);
    if (!row) return adminNotFound();
    revalidatePublicPages();
    const body: AdminWriteResponse<Business> = { row, persisted: isPersisted() };
    return adminJson(body);
  } catch (err) {
    return adminError(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  try {
    const row = await deleteAdminBusiness(id);
    if (!row) return adminNotFound();
    revalidatePublicPages();
    const body: AdminWriteResponse<Business> = { row, persisted: isPersisted() };
    return adminJson(body);
  } catch (err) {
    return adminError(err);
  }
}
