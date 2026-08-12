-- RAG phase 6: HyDE (Hypothetical Document Embeddings) for the vector-search
-- leg of query retrieval, kept swappable against plain raw-question
-- embedding (see supabase/functions/_shared/queryEmbeddingInput.ts). This
-- table records which strategy was used per query so retrieval quality can
-- be compared after the fact (hyde_text is the fabricated hypothetical
-- entry that was actually embedded — stored for that comparison only, never
-- shown to end users or fed into synthesis).

create table if not exists query_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  embedding_strategy text not null check (embedding_strategy in ('raw', 'hyde')),
  hyde_text text,
  matched boolean not null,
  result_count int not null,
  created_at timestamptz not null default now(),
  constraint query_log_hyde_text_requires_strategy
    check (embedding_strategy = 'hyde' or hyde_text is null)
);

create index if not exists query_log_user_id_created_at_idx
  on query_log (user_id, created_at desc);

alter table query_log enable row level security;

drop policy if exists "Users can select own query log" on query_log;
create policy "Users can select own query log"
  on query_log for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own query log" on query_log;
create policy "Users can insert own query log"
  on query_log for insert
  with check (auth.uid() = user_id);
