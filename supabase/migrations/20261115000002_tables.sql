-- SabaiSafe: tables. Owner: backend. Contracts v0.2 §2.1–2.6.
-- Enum-like columns use CHECK constraints (not Postgres enums) so adding a value is a one-line migration.
-- Keep the lists in sync with types/api.ts (PRICE_UNITS, categories) and lib/db/schema.ts.
-- Phone format (help_contacts, businesses): short code ("1155") or "+66 76 123 456"; mirrors PHONE_RE.

-- ---------------------------------------------------------------- legal_chunks (§2.1)
create table public.legal_chunks (
  id bigint generated always as identity primary key,
  doc_slug text not null,
  chunk_index int not null check (chunk_index >= 0),
  lang text not null check (lang in ('en', 'zh')),
  title text not null,
  law text not null,
  law_th text,
  section text,
  location text,
  source_url text,
  topic text not null check (topic in (
    'scam', 'price', 'transport', 'rental', 'alcohol_drugs', 'beach_rules',
    'accommodation', 'police_procedure', 'visa_immigration', 'other')),
  status text not null check (status in ('DRAFT', 'VERIFIED')),
  heading text,
  content text not null,
  content_hash text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doc_slug, lang, chunk_index)
);
create index legal_chunks_embedding_hnsw on public.legal_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index legal_chunks_lang_idx on public.legal_chunks (lang);

-- ---------------------------------------------------------------- prices (§2.3)
create table public.prices (
  id uuid primary key default gen_random_uuid(),
  item_key text not null check (item_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  item_name_en text not null,
  item_name_zh text not null,
  category text not null check (category in ('transport', 'rental', 'activity', 'food', 'accommodation', 'other')),
  area text not null,
  min_thb numeric(10, 2) not null check (min_thb >= 0),
  max_thb numeric(10, 2) not null,
  unit text not null check (unit in (
    'per_trip', 'per_km', 'per_person', 'per_30min', 'per_hour',
    'per_day', 'per_week', 'per_night', 'per_item', 'per_kg')),
  is_fixed_by_law boolean not null default false,
  source text not null,
  source_url text,
  collected_at date not null,
  notes text,
  notes_zh text,
  is_sample boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_thb <= max_thb),
  check (not is_fixed_by_law or source_url is not null),
  unique (item_key, area, source, collected_at)
);

-- ---------------------------------------------------------------- businesses (§2.4)
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_zh text,
  category text not null check (category in ('rental', 'transport', 'tour', 'hotel', 'restaurant', 'shop', 'other')),
  area text not null,
  address text,
  phone text check (phone is null or phone ~ '^([0-9]{3,5}|\+[0-9]{1,3}( [0-9]{1,4}){2,5})$'),
  website text,
  google_maps_url text,
  source_url text,
  description_en text,
  description_zh text,
  criteria_met text[] not null default '{}' check (criteria_met <@ array[
    'registered_business', 'displays_prices', 'written_contract',
    'no_passport_deposit', 'insurance', 'receipts']::text[]),
  is_sponsored boolean not null default false,
  verified_at date,
  is_active boolean not null default true,
  is_sample boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phone rule: a phone needs an official source and a verification date.
  check (phone is null or (source_url is not null and verified_at is not null)),
  unique (name, area)
);
create index businesses_name_idx on public.businesses (name);

-- ---------------------------------------------------------------- help_contacts (§2.5)
create table public.help_contacts (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('emergency', 'police', 'hospital', 'embassy', 'consumer', 'immigration', 'other')),
  name_en text not null,
  name_zh text,
  name_th text,
  phone text check (phone is null or phone ~ '^([0-9]{3,5}|\+[0-9]{1,3}( [0-9]{1,4}){2,5})$'),
  address text,
  area text,
  google_maps_url text,
  website text,
  hours text,
  languages text[] not null default '{}',
  source_url text,
  sort_order int not null default 100,
  verified boolean not null default false,
  is_sample boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phone rule: a phone needs an official source page and verified = true. The four hotlines use lib/hotlines.ts as their
  -- source and are seeded with source_url = null, so they are exempted by number.
  check (phone is null or (source_url is not null and verified) or phone in ('1155', '191', '1669', '1166')),
  unique (category, name_en)
);

-- ---------------------------------------------------------------- reports (§2.6)
-- Only the service role touches this table (no RLS policies). No IP, user agent, phone or passport number.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  lang text not null check (lang in ('en', 'zh')),
  incident_type text not null,
  facts jsonb not null,
  markdown text not null,
  consent_at timestamptz not null default now(),
  consent_version text not null,
  delete_token_hash text not null check (delete_token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_expires_at_idx on public.reports (expires_at);

-- ---------------------------------------------------------------- updated_at triggers
create trigger legal_chunks_updated_at before update on public.legal_chunks
  for each row execute function public.set_updated_at();
create trigger prices_updated_at before update on public.prices
  for each row execute function public.set_updated_at();
create trigger businesses_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();
create trigger help_contacts_updated_at before update on public.help_contacts
  for each row execute function public.set_updated_at();
create trigger reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();
