// GET/POST /api/admin/prices. Owner: backend. Contracts §3.9. Auth: middleware (HTTP Basic).
import { createAdminPrice, isPersisted, listAdminPrices } from "@/lib/db/admin";
import type { AdminListResponse, AdminWriteResponse, PriceRef } from "@/types/api";
import { adminError, adminJson, readJson, revalidatePublicPages } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes no input; the optional Request only matches the handler signature (tests call GET(req)).
export async function GET(_req?: Request): Promise<Response> {
  void _req;
  try {
    const body: AdminListResponse<PriceRef> = { results: await listAdminPrices(), persisted: isPersisted() };
    return adminJson(body);
  } catch (err) {
    return adminError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJson(req);
  if (parsed instanceof Response) return parsed;
  try {
    const body: AdminWriteResponse<PriceRef> = { row: await createAdminPrice(parsed.body), persisted: isPersisted() };
    revalidatePublicPages();
    return adminJson(body, 201);
  } catch (err) {
    return adminError(err);
  }
}
