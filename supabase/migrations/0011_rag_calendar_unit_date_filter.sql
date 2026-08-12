-- Date-range extraction is replaced by date-filter extraction: a set of
-- explicit calendar-unit patterns ("last week", "this month", a bare month
-- name, ...), matched deterministically and falling back to chrono-node
-- parsing only when none of them match. See
-- supabase/functions/_shared/dateExtraction.ts.
--
-- One new outcome that didn't exist before: a bare month name with no
-- accompanying year ("in may") now resolves to a *recurring* filter — every
-- May, any year — rather than a single date range, since there's no
-- contiguous start/end to compute for "every May". filter_chunks gains a
-- parameter for it, ANDed in alongside the existing filters/range.

create or replace function filter_chunks(
  filter_emotions text[] default null,
  filter_entities text[] default null,
  filter_topics text[] default null,
  filter_start timestamptz default null,
  filter_end timestamptz default null,
  match_count int default 50,
  filter_recurring_month int default null
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
    and (filter_recurring_month is null or extract(month from entries.created_at) = filter_recurring_month)
  order by entries.created_at desc
  limit match_count;
$$;

revoke all on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int, int) from public;
grant execute on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int, int) to authenticated;

-- Extend the query log with what date_filter resolved to and how — mirrors
-- the extracted_emotion/topics/entities + resolved_by columns from phase 7,
-- plus the pattern-matching diagnostics unique to date_filter: which
-- calendar-unit pattern won, and every pattern that matched (so the
-- "largest range wins" tradeoff can be spot-checked against real
-- questions — more than one entry in date_all_matched_patterns is exactly
-- that case in action).
alter table query_log
  add column if not exists extracted_date_filter_type text check (extracted_date_filter_type in ('range', 'recurring_month')),
  add column if not exists extracted_date_recurring_month int,
  add column if not exists date_resolved_by text check (date_resolved_by in ('calendar-unit', 'chrono')),
  add column if not exists date_matched_pattern text,
  add column if not exists date_all_matched_patterns text[];
