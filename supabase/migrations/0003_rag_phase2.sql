-- RAG phase 2: structured metadata extraction per chunk.
-- Still no retrieval — this just adds tags for chunks to carry.

create table if not exists chunk_metadata (
  chunk_id uuid primary key references chunks(id) on delete cascade,
  emotion text,
  emotion_confidence numeric,
  intensity int check (intensity between 1 and 5),
  topics text[],
  entities text[],
  extraction_model text not null,
  extraction_version text not null,
  created_at timestamptz not null default now()
);

alter table chunk_metadata enable row level security;

drop policy if exists "Users can select own chunk metadata" on chunk_metadata;
create policy "Users can select own chunk metadata"
  on chunk_metadata for select
  using (
    exists (
      select 1 from chunks
      join entries on entries.id = chunks.entry_id
      where chunks.id = chunk_metadata.chunk_id
        and entries.user_id = auth.uid()
    )
  );
