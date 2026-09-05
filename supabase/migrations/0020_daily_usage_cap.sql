-- Daily per-account spend cap on OpenAI-backed features (process-entry,
-- reflect, synthesize-answer, search-chunks, hybrid-search,
-- transcribe-audio). Each edge function calls get_daily_usage_usd(user) to
-- check against DAILY_USAGE_CAP_USD before spending, then records its own
-- estimated cost here after the call completes (see
-- supabase/functions/_shared/usage.ts).

create table if not exists api_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  function_name text not null,
  cost_usd numeric(10, 6) not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index if not exists api_usage_user_id_created_at_idx
  on api_usage (user_id, created_at desc);

alter table api_usage enable row level security;

drop policy if exists "Users can select own api usage" on api_usage;
create policy "Users can select own api usage"
  on api_usage for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own api usage" on api_usage;
create policy "Users can insert own api usage"
  on api_usage for insert
  with check (auth.uid() = user_id);

-- Sums a user's estimated spend since midnight UTC. Not security definer --
-- it runs with the caller's own privileges, so RLS above already scopes the
-- sum to their own rows for a user-authenticated caller, and the service
-- role (process-entry/transcribe-audio, invoked by DB webhooks rather than
-- a user session) bypasses RLS entirely as usual.
create or replace function get_daily_usage_usd(p_user_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost_usd), 0)
  from api_usage
  where user_id = p_user_id
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;

grant execute on function get_daily_usage_usd(uuid) to authenticated, service_role;
