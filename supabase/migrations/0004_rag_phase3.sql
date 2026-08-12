-- RAG phase 3: vector-only retrieval.
-- SECURITY INVOKER means this runs as the calling (authenticated) user, so
-- the existing RLS policies on chunks/embeddings scope results to their own
-- entries automatically — no manual user_id filtering needed here.
create or replace function match_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int default 20
)
returns table (
  chunk_id uuid,
  entry_id uuid,
  chunk_index int,
  text text,
  similarity float
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
    1 - (embeddings.vector <=> query_embedding) as similarity
  from embeddings
  join chunks on chunks.id = embeddings.chunk_id
  where 1 - (embeddings.vector <=> query_embedding) >= match_threshold
  order by embeddings.vector <=> query_embedding asc
  limit match_count;
$$;

revoke all on function match_chunks(vector, float, int) from public;
grant execute on function match_chunks(vector, float, int) to authenticated;
