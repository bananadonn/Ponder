-- Removes NL date-range/date-filter extraction entirely (calendar-unit
-- patterns, chrono-node fallback, recurring-month). Words like "august" or
-- "may" can be a month or a name, and "yesterday" can be a date constraint
-- or the literal topic of the question ("times I reflected on
-- yesterday") — that ambiguity isn't a parsing bug to fix, it's inherent
-- to the language, so date filtering now comes only from an explicit UI
-- control (see supabase/functions/hybrid-search/index.ts's date-range
-- narrowing step), never from `query` text. See
-- supabase/functions/_shared/queryExtraction.ts, which reverts to
-- { emotion, topics, entities } only.

-- Drop the 7-arg version added in 0011 (filter_recurring_month). Note that
-- 0011's `create or replace function filter_chunks(...7 args...)` did NOT
-- replace the original 6-arg version from 0005 — different parameter
-- lists make it a distinct overload in Postgres, not a replacement — so
-- both signatures have coexisted since 0011. Use `create or replace` below
-- (not plain `create`) so this is safe whether or not the 6-arg version is
-- still present.
drop function if exists filter_chunks(text[], text[], text[], timestamptz, timestamptz, int, int);

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

-- Drop every date-extraction-specific query_log column added in 0010/0011
-- — query extraction no longer produces a date field of any kind, so none
-- of these will ever be populated again.
alter table query_log
  drop column if exists extracted_date_range_start,
  drop column if exists extracted_date_range_end,
  drop column if exists extracted_date_filter_type,
  drop column if exists extracted_date_recurring_month,
  drop column if exists date_resolved_by,
  drop column if exists date_matched_pattern,
  drop column if exists date_all_matched_patterns;
