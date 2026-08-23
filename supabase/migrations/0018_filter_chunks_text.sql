-- Adds a `filter_text` parameter to filter_chunks for the Rack-filter-
-- constrained live substring search in Search & Reflect's Retrieval mode:
-- every keystroke does a plain ILIKE match (no embeddings/OpenAI call),
-- narrowed by whatever emotion/topic/entity/date filters are active in the
-- Rack, using the exact same AND/OR semantics already applied there.
-- Pressing Enter escalates to the existing hybrid-search vector pipeline
-- (unaffected by this migration) for the same filters.
--
-- Adding a parameter changes the function's argument-type signature, so
-- `create or replace` would create a second overload rather than replacing
-- the old one — drop it first so only one `filter_chunks` exists (avoids
-- PostgREST ambiguity when a call omits the new optional parameter).
drop function if exists filter_chunks(text[], text[], text[], timestamptz, timestamptz, int);

create function filter_chunks(
  filter_emotions text[] default null,
  filter_entities text[] default null,
  filter_topics text[] default null,
  filter_start timestamptz default null,
  filter_end timestamptz default null,
  match_count int default 50,
  filter_text text default null
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
    (filter_emotions is null or
      chunk_metadata.emotion = any(filter_emotions) or
      chunk_metadata.secondary_emotion = any(filter_emotions))
    and (filter_entities is null or exists (
      select 1 from unnest(chunk_metadata.entities) as e where e ilike any(filter_entities)
    ))
    and (filter_topics is null or exists (
      select 1 from unnest(chunk_metadata.topics) as t where t ilike any(filter_topics)
    ))
    and (filter_start is null or entries.created_at >= filter_start)
    and (filter_end is null or entries.created_at <= filter_end)
    and (filter_text is null or chunks.text ilike '%' || filter_text || '%')
  order by entries.created_at desc
  limit match_count;
$$;

revoke all on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int, text) from public;
grant execute on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int, text) to authenticated;
