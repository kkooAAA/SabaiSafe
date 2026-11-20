// GET/POST /api/admin/businesses. Owner: backend. Contracts §3.9. Auth: middleware (HTTP Basic).
import { createAdminBusiness, isPersisted, listAdminBusinesses } from "@/lib/db/admin";
import type { AdminListResponse, AdminWriteResponse, Business } from "@/types/api";
import { adminError, adminJson, readJson, revalidatePublicPages } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes no input; the optional Request only matches the handler signature (tests call GET(req)).
export async function GET(_req?: Request): Promise<Response> {
  void _req;
  try {
    const body: AdminListResponse<Business> = { results: await listAdminBusinesses(), persisted: isPersisted() };
    return adminJson(body);
  } catch (err) {
    return adminError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJson(req);
  if (parsed instanceof Response) return parsed;
  try {
    const body: AdminWriteResponse<Business> = { row: await createAdminBusiness(parsed.body), persisted: isPersisted() };
    revalidatePublicPages();
    return adminJson(body, 201);
  } catch (err) {
    return adminError(err);
  }
}
