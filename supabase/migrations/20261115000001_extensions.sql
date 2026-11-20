-- SabaiSafe: extensions. Owner: backend. Contracts v0.2 §2.
-- pg_cron must be available (Supabase: Dashboard > Database > Extensions). If it is not, this migration
-- fails loudly on purpose: report expiry (PDPA, 30 days) depends on it.
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

-- Shared trigger function for updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
