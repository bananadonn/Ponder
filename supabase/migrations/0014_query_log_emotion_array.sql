-- Query extraction's emotion field is now an array (a question can name
-- more than one real emotion for the same event, e.g. "proud but anxious")
-- instead of a single value — see supabase/functions/_shared/emotionSynonyms.ts
-- and queryExtraction.ts. query_log.extracted_emotion must widen to match;
-- existing single-value logs become single-element arrays rather than
-- being discarded.
alter table query_log
  alter column extracted_emotion type text[]
  using case when extracted_emotion is null then null else array[extracted_emotion] end;
