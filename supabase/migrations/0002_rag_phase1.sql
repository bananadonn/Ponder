-- RAG phase 1: chunking + embedding storage.
-- No retrieval/extraction logic depends on this yet — just chunks, their
-- embeddings, and a status flag so we know what's been processed.

create extension if not exists vector;

alter table entries
  add column if not exists processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'complete', 'failed'));

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  chunk_index int not null,
  text text not null,
  created_at timestamptz not null default now(),
  unique (entry_id, chunk_index)
);

create index if not exists chunks_entry_id_idx on chunks (entry_id);

create table if not exists embeddings (
  chunk_id uuid primary key references chunks(id) on delete cascade,
  vector vector(1536) not null,
  embedding_model text not null,
  embedding_version text not null,
  created_at timestamptz not null default now()
);

-- RLS: chunks/embeddings have no user_id of their own, so scope through
-- the owning entry. Only SELECT policies — all writes go through the
-- Edge Function using the service role key, which bypasses RLS by design.
alter table chunks enable row level security;
alter table embeddings enable row level security;

drop policy if exists "Users can select own chunks" on chunks;
create policy "Users can select own chunks"
  on chunks for select
  using (
    exists (
      select 1 from entries
      where entries.id = chunks.entry_id
        and entries.user_id = auth.uid()
    )
  );

drop policy if exists "Users can select own embeddings" on embeddings;
create policy "Users can select own embeddings"
  on embeddings for select
  using (
    exists (
      select 1 from chunks
      join entries on entries.id = chunks.entry_id
      where chunks.id = embeddings.chunk_id
        and entries.user_id = auth.uid()
    )
  );
