-- v1 journal entries schema
-- Kept deliberately simple: metadata jsonb is reserved for future mood tags,
-- embedding status, extracted entities, etc. without needing a migration.

create extension if not exists pgcrypto;

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create index if not exists entries_user_id_created_at_idx
  on entries (user_id, created_at desc);

-- Keep updated_at accurate regardless of which client writes the row.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists entries_set_updated_at on entries;
create trigger entries_set_updated_at
  before update on entries
  for each row
  execute function set_updated_at();

-- Row Level Security: users may only read/write their own entries.
alter table entries enable row level security;

drop policy if exists "Users can select own entries" on entries;
create policy "Users can select own entries"
  on entries for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own entries" on entries;
create policy "Users can insert own entries"
  on entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own entries" on entries;
create policy "Users can update own entries"
  on entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own entries" on entries;
create policy "Users can delete own entries"
  on entries for delete
  using (auth.uid() = user_id);
