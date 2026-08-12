-- Supports query extraction's Layer 2 entities fallback (phase 7): entities
-- had the same open-generation problem topics was fixed for in
-- 0009_list_known_topics.sql (the LLM can invent an entity name that
-- matches zero real chunks) but never got the equivalent fix. The LLM is
-- now constrained to choose zero or more entities from the user's own
-- existing vocabulary, same as topics. This lists that closed set. See
-- supabase/functions/_shared/queryExtraction.ts.
create or replace function list_known_entities()
returns table (
  entity text
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct unnest(chunk_metadata.entities) as entity
  from chunk_metadata
  join chunks on chunks.id = chunk_metadata.chunk_id
  join entries on entries.id = chunks.entry_id
  where chunk_metadata.entities is not null
  order by 1;
$$;

revoke all on function list_known_entities() from public;
grant execute on function list_known_entities() to authenticated;
