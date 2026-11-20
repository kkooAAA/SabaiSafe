-- SabaiSafe: vector search RPC. Owner: backend. Contracts v0.2 §2.2.
-- IMPORTANT: the parameter `lang` must always be written as `match_legal.lang`. An unqualified `lang`
-- resolves to the column and silently disables the language filter.
-- No similarity threshold here: ai applies it (LEGAL_MIN_SIMILARITY).

create or replace function public.match_legal(
  query_embedding extensions.vector(1536),
  match_count int,
  lang text
)
returns table (
  id bigint,
  doc_slug text,
  chunk_index int,
  lang text,
  title text,
  law text,
  law_th text,
  section text,
  location text,
  source_url text,
  topic text,
  status text,
  heading text,
  content text,
  similarity float
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    lc.id,
    lc.doc_slug,
    lc.chunk_index,
    lc.lang,
    lc.title,
    lc.law,
    lc.law_th,
    lc.section,
    lc.location,
    lc.source_url,
    lc.topic,
    lc.status,
    lc.heading,
    lc.content,
    (1 - (lc.embedding operator(extensions.<=>) match_legal.query_embedding))::float as similarity
  from public.legal_chunks lc
  where match_legal.lang is null or lc.lang = match_legal.lang
  order by lc.embedding operator(extensions.<=>) match_legal.query_embedding
  limit least(greatest(coalesce(match_legal.match_count, 6), 1), 20);
$$;

revoke all on function public.match_legal(extensions.vector, int, text) from public;
grant execute on function public.match_legal(extensions.vector, int, text) to anon, authenticated, service_role;
