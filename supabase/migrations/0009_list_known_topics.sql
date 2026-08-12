-- Supports query extraction's Layer 2 topics fallback (phase 7): rather than
-- letting the LLM freely invent topic text (which can echo the question
-- back verbatim, as observed — "sad moment" was returned as a "topic" for
-- the question "sad moment", matching zero real chunks), the LLM is now
-- constrained to choose zero or more topics from the user's own existing
-- vocabulary. This lists that closed set. See
-- supabase/functions/_shared/queryExtraction.ts.
create or replace function list_known_topics()
returns table (
  topic text
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct unnest(chunk_metadata.topics) as topic
  from chunk_metadata
  join chunks on chunks.id = chunk_metadata.chunk_id
  join entries on entries.id = chunks.entry_id
  where chunk_metadata.topics is not null
  order by 1;
$$;

revoke all on function list_known_topics() from public;
grant execute on function list_known_topics() to authenticated;
