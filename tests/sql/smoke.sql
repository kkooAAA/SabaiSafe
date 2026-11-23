-- SabaiSafe DB smoke test (qa). Runs in CI (job db-smoke) after supabase/migrations/*.sql and supabase/seed.sql.
-- psql -v ON_ERROR_STOP=1: any failed check raises an exception and fails the job.
-- Covers: match_legal (lang filter, cap of 20, min 1, ordering), RLS (anon cannot read reports or write any table,
-- anon sees only active businesses), report time trigger, pg_cron job, seed invariants (hotlines, phone rules).
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures (rolled back at the end)
-- 25 en + 5 zh chunks, interleaved: zh = i in (2,4,6,8,10), en = the rest (1, 3, 5, 7, 9, 11..30).
-- chunk i = (1 in dim 1, i/10 in dim i+1), so cosine similarity to the query (dim 1 only)
-- is 1/sqrt(1 + (i/10)^2): strictly decreasing with i, all distinct.
-- zh must sit among the HIGHEST similarities: the unfiltered top 20 (lang=null) is i 1..20 = 15 en + 5 zh,
-- so it has 2 languages. (zh at i 26..30 were the 5 lowest, so lang=null returned only en.)
-- Still: en has 25 rows (cap 20 holds), zh has 5, the top en hit is qa-smoke-1.
create temporary table _vec as
select i, ('[' || array_to_string(array(select case when d = 1 then 1.0 when d = i + 1 then i * 0.1 else 0 end
                                        from generate_series(1, 1536) d), ',') || ']')::extensions.vector(1536) as v
from generate_series(1, 30) i;

insert into public.legal_chunks (doc_slug, chunk_index, lang, title, law, topic, status, content, content_hash, embedding)
select 'qa-smoke-' || i, 0, case when i in (2, 4, 6, 8, 10) then 'zh' else 'en' end, 'QA ' || i, 'QA law', 'other', 'DRAFT',
       'qa smoke chunk ' || i, md5(i::text), v
from _vec;

create temporary table _q as
select ('[' || array_to_string(array(select case when d = 1 then 1.0 else 0 end from generate_series(1, 1536) d), ',') || ']')::extensions.vector(1536) as q;

-- ---------------------------------------------------------------- match_legal
do $$
declare
  q extensions.vector(1536) := (select q from _q);
  n int;
  bad int;
begin
  select count(*) into n from public.match_legal(q, 100, 'en');
  if n <> 20 then raise exception 'FAIL match_legal cap: expected 20, got %', n; end if;

  select count(*) into bad from public.match_legal(q, 100, 'en') where lang <> 'en';
  if bad <> 0 then raise exception 'FAIL match_legal lang filter: % non-en rows for lang=en', bad; end if;

  select count(*) into n from public.match_legal(q, 20, 'zh');
  if n <> 5 then raise exception 'FAIL match_legal zh: expected 5, got %', n; end if;

  select count(*) into n from (select distinct lang from public.match_legal(q, 20, null)) s;
  if n <> 2 then raise exception 'FAIL match_legal lang=null should not filter (got % languages)', n; end if;

  select count(*) into n from public.match_legal(q, 0, 'en');
  if n <> 1 then raise exception 'FAIL match_legal match_count=0 should return 1 row, got %', n; end if;

  select count(*) into n from public.match_legal(q, null, 'en');
  if n <> 6 then raise exception 'FAIL match_legal match_count=null should default to 6, got %', n; end if;

  -- ordered by similarity, descending, and similarity is in [0, 1]
  select count(*) into bad from (
    select similarity, lag(similarity) over (order by ord) as prev
    from (select similarity, row_number() over () as ord from public.match_legal(q, 20, 'en')) t
  ) s where prev is not null and similarity > prev + 1e-9;
  if bad <> 0 then raise exception 'FAIL match_legal not ordered by similarity'; end if;
  if exists (select 1 from public.match_legal(q, 20, 'en') where similarity < 0 or similarity > 1.000001) then
    raise exception 'FAIL match_legal similarity out of range';
  end if;
  if (select doc_slug from public.match_legal(q, 1, 'en')) <> 'qa-smoke-1' then
    raise exception 'FAIL match_legal top hit should be qa-smoke-1';
  end if;
end $$;

-- ---------------------------------------------------------------- report time trigger (service side)
insert into public.reports (lang, incident_type, facts, markdown, consent_version, delete_token_hash, consent_at, expires_at)
values ('en', 'scam', '{}'::jsonb, 'qa', '2026-11-v1', repeat('a', 64), '2000-01-01', '2999-01-01');
do $$
begin
  if exists (select 1 from public.reports where markdown = 'qa'
             and (expires_at > now() + interval '30 days 1 minute' or expires_at < now() + interval '29 days 23 hours'
                  or consent_at < now() - interval '1 minute')) then
    raise exception 'FAIL reports trigger: caller-supplied consent_at/expires_at were kept';
  end if;
end $$;

do $$
begin
  begin
    insert into public.reports (lang, incident_type, facts, markdown, consent_version, delete_token_hash)
    values ('en', 'scam', '{}'::jsonb, 'qa2', 'v', 'not-a-hash');
    raise exception 'FAIL reports accepted a malformed delete_token_hash';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------- pg_cron
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'delete-expired-reports'
                 and command ilike '%delete from public.reports where expires_at < now()%') then
    raise exception 'FAIL pg_cron job delete-expired-reports missing';
  end if;
end $$;

-- ---------------------------------------------------------------- seed invariants
do $$
declare n int;
begin
  select count(*) into n from public.help_contacts where phone in ('1155', '191', '1669', '1166') and verified and not is_sample;
  if n <> 4 then raise exception 'FAIL seed: expected the 4 verified hotlines, got %', n; end if;
  if exists (select 1 from public.help_contacts where phone is not null and phone not in ('1155', '191', '1669', '1166')
             and (source_url is null or not verified)) then
    raise exception 'FAIL seed: a non-hotline phone without source_url + verified';
  end if;
  if exists (select 1 from public.businesses where is_sample and (phone is not null or name not like '[SAMPLE] %')) then
    raise exception 'FAIL seed: sample business with a phone or without [SAMPLE] prefix';
  end if;
  select count(*) into n from public.prices;
  if n < 25 then raise exception 'FAIL seed: expected >= 25 prices, got %', n; end if;
end $$;

-- An inactive business, to check that anon cannot see it.
insert into public.businesses (name, category, area, criteria_met, is_sponsored, is_active, is_sample)
values ('[SAMPLE] QA Inactive', 'shop', 'Patong', '{}', false, false, true);

-- ---------------------------------------------------------------- RLS as anon
set local role anon;

do $$
declare
  n int;
  -- built inline: anon has no access to this session's temp tables
  q extensions.vector(1536) := ('[' || array_to_string(array(select case when d = 1 then 1.0 else 0 end
                                  from generate_series(1, 1536) d), ',') || ']')::extensions.vector(1536);
begin
  -- reads that must work
  perform 1 from public.prices limit 1;
  perform 1 from public.help_contacts limit 1;
  perform 1 from public.legal_chunks limit 1;
  select count(*) into n from public.match_legal(q, 3, 'en');
  if n <> 3 then raise exception 'FAIL anon cannot use match_legal (got % rows)', n; end if;
  if exists (select 1 from public.businesses where not is_active) then
    raise exception 'FAIL anon can see inactive businesses';
  end if;

  -- reports: no access at all
  begin perform 1 from public.reports; raise exception 'FAIL anon can read reports';
  exception when insufficient_privilege then null; end;
  begin insert into public.reports (lang, incident_type, facts, markdown, consent_version, delete_token_hash)
        values ('en', 'x', '{}', 'x', 'x', repeat('b', 64)); raise exception 'FAIL anon can insert reports';
  exception when insufficient_privilege then null; end;
  begin delete from public.reports; raise exception 'FAIL anon can delete reports';
  exception when insufficient_privilege then null; end;

  -- no writes on any public table
  begin insert into public.prices (item_key, item_name_en, item_name_zh, category, area, min_thb, max_thb, unit, source, collected_at)
        values ('qa_x', 'x', 'x', 'other', 'Patong', 1, 2, 'per_item', 'x', current_date); raise exception 'FAIL anon can insert prices';
  exception when insufficient_privilege then null; end;
  begin update public.prices set max_thb = 1; raise exception 'FAIL anon can update prices';
  exception when insufficient_privilege then null; end;
  begin delete from public.prices; raise exception 'FAIL anon can delete prices';
  exception when insufficient_privilege then null; end;
  begin update public.businesses set is_sponsored = true; raise exception 'FAIL anon can update businesses';
  exception when insufficient_privilege then null; end;
  begin delete from public.help_contacts; raise exception 'FAIL anon can delete help_contacts';
  exception when insufficient_privilege then null; end;
  begin insert into public.help_contacts (category, name_en, languages, sort_order, verified, is_sample)
        values ('other', 'x', '{}', 0, false, true); raise exception 'FAIL anon can insert help_contacts';
  exception when insufficient_privilege then null; end;
  begin delete from public.legal_chunks; raise exception 'FAIL anon can delete legal_chunks';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role authenticated;
do $$
begin
  begin perform 1 from public.reports; raise exception 'FAIL authenticated can read reports';
  exception when insufficient_privilege then null; end;
  begin delete from public.prices; raise exception 'FAIL authenticated can delete prices';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
\echo 'db smoke: ALL CHECKS PASSED'
