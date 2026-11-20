-- SabaiSafe: row level security. Owner: backend. Contracts v0.2 §2.
-- anon (and authenticated) may only read prices, active businesses, help_contacts and legal_chunks.
-- reports has RLS enabled and NO policies: only the service role (which bypasses RLS) can touch it.

alter table public.legal_chunks enable row level security;
alter table public.prices enable row level security;
alter table public.businesses enable row level security;
alter table public.help_contacts enable row level security;
alter table public.reports enable row level security;

create policy "public read legal_chunks" on public.legal_chunks
  for select to anon, authenticated using (true);
create policy "public read prices" on public.prices
  for select to anon, authenticated using (true);
create policy "public read active businesses" on public.businesses
  for select to anon, authenticated using (is_active);
create policy "public read help_contacts" on public.help_contacts
  for select to anon, authenticated using (true);

-- Defence in depth: remove write privileges from the public roles entirely, and every privilege on reports.
revoke insert, update, delete, truncate on public.legal_chunks, public.prices, public.businesses, public.help_contacts
  from anon, authenticated;
revoke all on public.reports from anon, authenticated;

-- reports: the server never trusts the caller for consent_at / expires_at (PDPA, §2.6).
create or replace function public.reports_force_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.consent_at := now();
  new.expires_at := now() + interval '30 days';
  return new;
end;
$$;

create trigger reports_force_times before insert on public.reports
  for each row execute function public.reports_force_times();
