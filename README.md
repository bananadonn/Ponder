# Ponder

A minimal journaling app: markdown entries, Supabase auth + Postgres, basic search.

## Setup

1. Create a Supabase project.
2. Run the migration in `supabase/migrations/0001_init.sql` against it (via the SQL editor or `supabase db push`).
3. In Supabase Auth settings, make sure email OTP / magic link sign-in is enabled.
4. Copy `.env.example` to `.env` and fill in your project's URL and anon key (Project Settings → API):

   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```

5. Install and run:

   ```
   npm install
   npm run dev
   ```

## Structure

- `src/data/` — Supabase queries and auth calls, framework-agnostic. Reused as-is by future mobile (Expo) and desktop (Tauri) clients.
- `src/hooks/` — React bindings over `src/data/` (`useAuth`, `useEntries`).
- `src/pages/` — routed screens (login, entry list, entry editor).
- `src/components/` — small presentational pieces.
- `src/lib/supabase.ts` — Supabase client instance.

## Out of scope for v1

Mood tags, rich text, vector search, entity extraction, mobile/desktop clients, offline sync. The `entries.metadata` jsonb column is reserved for these later without a schema migration.
