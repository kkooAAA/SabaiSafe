// Supabase clients. Owner: backend. Contracts v0.2 §4.
// Plain supabase-js, no cookies and no `server-only`: there is no user auth, and scripts/ingest.ts (tsx) and
// Vitest import lib/db outside Next. The service key has no NEXT_PUBLIC_ prefix, so it is never in a client bundle.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DbUnavailableError } from "./errors";

/** Empty NEXT_PUBLIC_SUPABASE_URL ⇒ sample mode (in-memory data from content/). */
export function isSampleMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let anon: SupabaseClient | null = null;
let service: SupabaseClient | null = null;

/** Read-only client (RLS applies). Throws DbUnavailableError in sample mode or without the anon key. */
export function createAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url) throw new DbUnavailableError("Sample mode: NEXT_PUBLIC_SUPABASE_URL is empty");
  if (!key) throw new DbUnavailableError("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing");
  anon ??= createClient(url, key, NO_SESSION);
  return anon;
}

/** Service-role client (bypasses RLS). Server only: ingest, reports, admin. */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new DbUnavailableError("Sample mode: NEXT_PUBLIC_SUPABASE_URL is empty");
  if (!key) throw new DbUnavailableError("SUPABASE_SERVICE_ROLE_KEY is missing");
  service ??= createClient(url, key, NO_SESSION);
  return service;
}

/** Tests only: forget cached clients after changing env. */
export function resetClients(): void {
  anon = null;
  service = null;
}
