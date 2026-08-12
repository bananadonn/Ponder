-- Fix: match_known_vocab (phase 7) let short vocab terms produce false
-- positive fuzzy matches. Verified against the live DB:
--   word_similarity('mom', 'sad moment') = 0.75
--   word_similarity('ana', 'i went for a banana split') = 0.5
-- both well above the 0.35 threshold despite being unrelated — "mom" is a
-- literal 3-character prefix of "moment", and a string that short has too
-- few trigrams for word_similarity to distinguish "appears inside an
-- unrelated word" from "is genuinely the same word". No threshold value
-- fixes this: real matches and coincidental collisions don't reliably
-- separate at any single cutoff once terms get this short.
--
-- Fix: gate fuzzy (word_similarity) matching to vocab terms of at least 5
-- characters, where trigram overlap does reliably separate real matches
-- (e.g. 'grandma' vs 'grandmas' scores 0.7) from coincidental ones. Terms
-- shorter than that fall back to an exact, word-boundary-aware match
-- instead — the same normalize-and-pad-with-spaces technique already used
-- by matchEmotionKeyword in supabase/functions/_shared/emotionSynonyms.ts,
-- so "mom" only matches when it appears as its own whole word, never as a
-- substring of a different word. Known tradeoff: this also stops catching
-- some genuine short-term variants (e.g. "job" vs "jobs" no longer fuzzy
-- matches) — accepted in favor of not matching on coincidence.
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
  ),
  normalized as (
    select
      value,
      kind,
      ' ' || trim(regexp_replace(lower(value), '[^a-z0-9]+', ' ', 'g')) || ' ' as normalized_value,
      ' ' || trim(regexp_replace(lower(question), '[^a-z0-9]+', ' ', 'g')) || ' ' as normalized_question
    from vocab
    where value is not null and length(trim(value)) > 0
  )
  select value, kind, score
  from (
    -- Short terms (<5 chars): exact whole-word match only.
    select value, kind, 1.0::float as score
    from normalized
    where length(value) < 5
      and position(normalized_value in normalized_question) > 0

    union all

    -- Longer terms: fuzzy match as before.
    select value, kind, word_similarity(value, question) as score
    from normalized
    where length(value) >= 5
      and word_similarity(value, question) >= match_threshold
  ) matches
  order by score desc;
$$;
