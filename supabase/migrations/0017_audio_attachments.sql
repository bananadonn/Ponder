-- Voice recording support: attachments gain transcription-related columns
-- (audio only -- image rows default to 'complete'/null and are otherwise
-- untouched), and entries can now have audio attachments alongside images.
-- Audio vs. image is distinguished by mime_type prefix, not a new column --
-- the bucket's own allowed_mime_types already scopes each bucket to one
-- media family.

alter table attachments add column if not exists transcript text;
alter table attachments add column if not exists transcription_status text
  not null default 'complete'
  check (transcription_status in ('pending', 'processing', 'complete', 'failed'));
alter table attachments add column if not exists duration_seconds numeric;

-- Private bucket for recorded voice notes, mirroring entry-images.
-- Path convention and RLS follow the same {user_id}/{entry_id}/{uuid}-{filename}
-- scheme -- see 0016_attachments.sql for the rationale.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entry-audio', 'entry-audio', false, 26214400,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'])
on conflict (id) do nothing;

drop policy if exists "Users can read own entry audio" on storage.objects;
create policy "Users can read own entry audio"
  on storage.objects for select
  using (bucket_id = 'entry-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can upload own entry audio" on storage.objects;
create policy "Users can upload own entry audio"
  on storage.objects for insert
  with check (bucket_id = 'entry-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete own entry audio" on storage.objects;
create policy "Users can delete own entry audio"
  on storage.objects for delete
  using (bucket_id = 'entry-audio' and (storage.foldername(name))[1] = auth.uid()::text);
