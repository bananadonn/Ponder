-- Rich-text composer support: entries gain a canonical rich-doc column
-- (content_doc), and entries can now have image attachments. entries.content
-- remains the derived plain-text rendering the whole existing pipeline
-- (chunking, process-entry, search) already depends on -- untouched by this
-- migration.

alter table entries add column if not exists content_doc jsonb;

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists attachments_entry_id_idx on attachments (entry_id);

alter table attachments enable row level security;

drop policy if exists "Users can select own attachments" on attachments;
create policy "Users can select own attachments"
  on attachments for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own attachments" on attachments;
create policy "Users can insert own attachments"
  on attachments for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own attachments" on attachments;
create policy "Users can delete own attachments"
  on attachments for delete
  using (auth.uid() = user_id);
-- No update policy: attachments are immutable once uploaded (delete + re-upload).

-- Private bucket for pasted/attached journal images. NOTE: if the local CLI
-- emulator doesn't honor allowed_mime_types/file_size_limit from this insert,
-- set them in supabase/config.toml's [storage.buckets.entry-images] instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entry-images', 'entry-images', false, 26214400,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

-- Path convention: {user_id}/{entry_id}/{uuid}-{filename}. RLS only checks
-- the first path segment (user_id) -- entry_id is included purely for
-- human-readable grouping/bulk-prefix listing, not for access control.
drop policy if exists "Users can read own entry images" on storage.objects;
create policy "Users can read own entry images"
  on storage.objects for select
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can upload own entry images" on storage.objects;
create policy "Users can upload own entry images"
  on storage.objects for insert
  with check (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete own entry images" on storage.objects;
create policy "Users can delete own entry images"
  on storage.objects for delete
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);
