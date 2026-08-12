-- A chunk can genuinely express two emotions at once (e.g. "proud but
-- anxious about what's next") — forcing a single dominant label discards
-- that. Adds an optional second emotion, kept as its own nullable
-- column (not an array) so the existing scalar `emotion` column and every
-- consumer of it stay untouched. secondary_emotion_confidence mirrors
-- emotion_confidence for the same reason that one exists: display-only
-- hand-checking in /debug/chunks, never used to gate or weight search
-- results (nothing in this schema gates on confidence for the primary
-- emotion either — see filter_chunks below, which only ever checks
-- equality, never a threshold).
alter table chunk_metadata
  add column if not exists secondary_emotion text,
  add column if not exists secondary_emotion_confidence numeric;

-- filter_chunks: OR the secondary emotion into the same emotion filter,
-- same semantics as matching on the primary — a chunk matches if EITHER
-- its dominant or secondary emotion is in the requested list.
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
  order by entries.created_at desc
  limit match_count;
$$;

revoke all on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int) from public;
grant execute on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int) to authenticated;
