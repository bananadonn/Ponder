-- RAG phase 7: automatic structured-filter extraction from the question
-- ("query extraction" / Prompt B), run in parallel with HyDE (phase 6). See
-- supabase/functions/_shared/queryExtraction.ts for the two-layer flow:
-- keyword/fuzzy-vocab matching first (no LLM call), LLM fallback only for
-- fields that leaves unresolved.

create extension if not exists pg_trgm;

-- Layer 1's topic/entity pass: fuzzy-matches topic/entity strings already
-- present in the user's own chunk_metadata against the raw question text, so
-- e.g. "times I felt weird about my job" can resolve topics=['job'] without
-- an LLM call. word_similarity (not similarity) is used deliberately — it
-- scores how well a short string matches *some substring* of a longer one,
-- which is the right primitive for "does this known term appear somewhere
-- in this question", unlike whole-string similarity comparing two texts of
-- very different lengths.
create or replace function match_known_vocab(
  question text,
  match_threshold float default 0.35
)
returns table (
  value text,
  kind text,
  score float
)
language sql
stable
security invoker
set search_path = public
as $$
  with vocab as (
    select distinct unnest(chunk_metadata.topics) as value, 'topic' as kind
    from chunk_metadata
    join chunks on chunks.id = chunk_metadata.chunk_id
    join entries on entries.id = chunks.entry_id
    where chunk_metadata.topics is not null
    union
    select distinct unnest(chunk_metadata.entities) as value, 'entity' as kind
    from chunk_metadata
    join chunks on chunks.id = chunk_metadata.chunk_id
    join entries on entries.id = chunks.entry_id
    where chunk_metadata.entities is not null
  )
  select value, kind, word_similarity(value, question) as score
  from vocab
  where value is not null
    and word_similarity(value, question) >= match_threshold
  order by score desc;
$$;

revoke all on function match_known_vocab(text, float) from public;
grant execute on function match_known_vocab(text, float) to authenticated;

-- Extend the query log (phase 6) with what got extracted and which layer
-- resolved each field — the tuning signal called for in phase 7: if the LLM
-- keeps resolving something Layer 1 should catch, that's a sign to expand
-- the keyword/synonym list in emotionSynonyms.ts.
alter table query_log
  add column if not exists extracted_emotion text,
  add column if not exists extracted_topics text[],
  add column if not exists extracted_entities text[],
  add column if not exists emotion_resolved_by text check (emotion_resolved_by in ('keyword', 'llm')),
  add column if not exists topics_resolved_by text check (topics_resolved_by in ('keyword', 'llm')),
  add column if not exists entities_resolved_by text check (entities_resolved_by in ('keyword', 'llm'));
