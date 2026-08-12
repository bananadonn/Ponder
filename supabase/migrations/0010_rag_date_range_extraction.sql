-- Query extraction gains a fourth, independent field: date_range, resolved
-- by chrono-node (deterministic parsing) rather than the keyword/LLM layers
-- used for emotion/topics/entities — see
-- supabase/functions/_shared/dateExtraction.ts and
-- supabase/functions/_shared/queryExtraction.ts.
--
-- No resolved_by column, unlike the other extracted fields: there's only
-- one resolution method here, not a keyword-vs-LLM choice to record. A
-- non-null pair is itself the thing worth logging — it flags which queries
-- to spot-check for parsing accuracy.
alter table query_log
  add column if not exists extracted_date_range_start timestamptz,
  add column if not exists extracted_date_range_end timestamptz;
