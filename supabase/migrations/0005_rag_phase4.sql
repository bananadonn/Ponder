-- RAG phase 4: structured filtering + hybrid merge with vector search.
-- Three primitives, kept independent and composed in the Edge Function
-- rather than one combined query, so vector-only and filter-only matches
-- stay distinguishable (needed for the debug UI's source tagging):
--   match_chunks   - existing (phase 3), now also returns entry_created_at
--   filter_chunks  - new: structured filter over chunk_metadata + date range
--   score_chunks   - new: similarity for an explicit set of chunk ids, used
--                    to give structured-only matches a comparable score

-- match_chunks' RETURNS TABLE shape is changing (added entry_created_at),
-- which CREATE OR REPLACE does not allow — drop and recreate.
drop function if exists match_chunks(vector, float, int);

create function match_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int default 20
)
returns table (
  chunk_id uuid,
  entry_id uuid,
  chunk_index int,
  text text,
  entry_created_at timestamptz,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    chunks.id as chunk_id,
    chunks.entry_id,
    chunks.chunk_index,
    chunks.text,
    entries.created_at as entry_created_at,
    1 - (embeddings.vector <=> query_embedding) as similarity
  from embeddings
  join chunks on chunks.id = embeddings.chunk_id
  join entries on entries.id = chunks.entry_id
  where 1 - (embeddings.vector <=> query_embedding) >= match_threshold
  order by embeddings.vector <=> query_embedding asc
  limit match_count;
$$;

revoke all on function match_chunks(vector, float, int) from public;
grant execute on function match_chunks(vector, float, int) to authenticated;

-- Faceted filter semantics: AND across emotions/entities/topics/date range,
-- OR within each array (e.g. entities=['Caty','Grandma'] matches either).
-- entities/topics use ILIKE so casing differences from LLM extraction
-- ("Grandma" vs "grandma") don't silently drop matches — this is still
-- exact(-ish) substring matching, not fuzzy/semantic; free-text tags from
-- an LLM will never be perfectly consistent, and that's a known limitation
-- rather than something this filter tries to solve.
create or replace function filter_chunks(
  filter_emotions text[] default null,
  filter_entities text[] default null,
  filter_topics text[] default null,
  filter_start timestamptz default null,
  filter_end timestamptz default null,
  match_count int default 50
)
returns table (
  chunk_id uuid,
  entry_id uuid,
  chunk_index int,
  text text,
  entry_created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    chunks.id as chunk_id,
    chunks.entry_id,
    chunks.chunk_index,
    chunks.text,
    entries.created_at as entry_created_at
  from chunks
  join entries on entries.id = chunks.entry_id
  left join chunk_metadata on chunk_metadata.chunk_id = chunks.id
  where
    (filter_emotions is null or chunk_metadata.emotion = any(filter_emotions))
    and (filter_entities is null or exists (
      select 1 from unnest(chunk_metadata.entities) as e where e ilike any(filter_entities)
    ))
    and (filter_topics is null or exists (
      select 1 from unnest(chunk_metadata.topics) as t where t ilike any(filter_topics)
    ))
    and (filter_start is null or entries.created_at >= filter_start)
    and (filter_end is null or entries.created_at <= filter_end)
  order by entries.created_at desc
  limit match_count;
$$;

revoke all on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int) from public;
grant execute on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int) to authenticated;

-- Gives structured-only matches (found via filter_chunks, never scored by
-- an ANN search) a similarity score against the query, so the merged set
-- can be ranked on one consistent signal instead of mixing scored and
-- unscored results.
create or replace function score_chunks(
  chunk_ids uuid[],
  query_embedding vector(1536)
)
returns table (
  chunk_id uuid,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    chunks.id as chunk_id,
    1 - (embeddings.vector <=> query_embedding) as similarity
  from chunks
  join embeddings on embeddings.chunk_id = chunks.id
  where chunks.id = any(chunk_ids);
$$;

revoke all on function score_chunks(uuid[], vector) from public;
grant execute on function score_chunks(uuid[], vector) to authenticated;
