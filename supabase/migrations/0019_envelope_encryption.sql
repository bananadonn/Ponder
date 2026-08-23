-- Envelope encryption: per-user Data Encryption Keys (DEKs) wrapped by a
-- single server-held master key (ENCRYPTION_MASTER_KEY, an Edge Function
-- secret -- never stored in this database, never sent to any client except
-- each user's own unwrapped DEK via the derive-key function). Lets entry
-- content, chunk text, transcripts, and attachment file bytes/filenames be
-- encrypted at rest so they're unreadable via casual DB/dashboard browsing
-- or a DB dump, while OpenAI-based embedding/extraction/reflect can still
-- decrypt transiently server-side to do their work. chunk_metadata
-- (emotion/topic/entity labels) and embeddings.vector stay plaintext --
-- both are required for server-side search/filtering.

create table if not exists user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wrapped_dek text not null,
  created_at timestamptz not null default now()
);

alter table user_keys enable row level security;
revoke all on table user_keys from anon, authenticated, public;
-- No policies created, deliberately: only service_role (BYPASSRLS) may
-- ever read/write this table, including for a user's own row -- a wrapped
-- DEK must never reach a client directly, only via derive-key's unwrapped
-- response over HTTPS to its owner.

-- content_doc becomes ciphertext-carrying text. NULL-safe cast: existing
-- NULL rows stay NULL, existing JSON rows become their text
-- representation -- still plaintext at this instant (the backfill script
-- encrypts it properly afterward), but no less exposed than
-- plaintext-as-jsonb was a moment before; decryptOrPassthrough treats
-- un-prefixed text as legacy plaintext in the meantime, so there's no
-- unsafe intermediate state, only an unencrypted-as-text one.
alter table entries alter column content_doc type text using content_doc::text;

-- filter_chunks loses its filter_text parameter: server-side ILIKE can
-- never match ciphertext once chunks.text is encrypted. Live substring
-- search moves client-side instead (decrypt candidates, filter in JS --
-- see src/data/search.ts's searchChunksSubstring). Drop-and-recreate is
-- required because a parameter-count change creates a new overload rather
-- than replacing the old one (the same hazard 0018's own comment
-- documents).
drop function if exists filter_chunks(text[], text[], text[], timestamptz, timestamptz, int, text);

create function filter_chunks(
  filter_emotions text[] default null,
  filter_entities text[] default null,
  filter_topics text[] default null,
  filter_start timestamptz default null,
  filter_end timestamptz default null,
  match_count int default 50
)
returns table (
  chunk_id uuid,
  entry_id uuid,
  chunk_index int,
  text text,
  entry_created_at timestamptz
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
    entries.created_at as entry_created_at
  from chunks
  join entries on entries.id = chunks.entry_id
  left join chunk_metadata on chunk_metadata.chunk_id = chunks.id
  where
    (filter_emotions is null or
      chunk_metadata.emotion = any(filter_emotions) or
      chunk_metadata.secondary_emotion = any(filter_emotions))
    and (filter_entities is null or exists (
      select 1 from unnest(chunk_metadata.entities) as e where e ilike any(filter_entities)
    ))
    and (filter_topics is null or exists (
      select 1 from unnest(chunk_metadata.topics) as t where t ilike any(filter_topics)
    ))
    and (filter_start is null or entries.created_at >= filter_start)
    and (filter_end is null or entries.created_at <= filter_end)
  order by entries.created_at desc
  limit match_count;
$$;

revoke all on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int) from public;
grant execute on function filter_chunks(text[], text[], text[], timestamptz, timestamptz, int) to authenticated;
