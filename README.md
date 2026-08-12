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
- `supabase/functions/` — server-side Edge Functions (Deno). Anything that needs a secret API key or must bypass RLS lives here, never in `src/`.
- `scripts/` — one-off admin/maintenance scripts run locally with Node, using the service role key.

## Out of scope for v1

Rich text, mobile/desktop clients, offline sync. The `entries.metadata` jsonb column is reserved for future per-entry (as opposed to per-chunk) needs without a schema migration.

## RAG pipeline — phase 1: chunking + embedding

Entries are split into paragraph chunks and embedded (OpenAI `text-embedding-3-small`, 1536 dims) via a Supabase Edge Function. No retrieval or extraction yet — this phase only produces `chunks` and `embeddings` rows so the pipeline itself can be verified before anything is built on top of it.

### One-time setup

1. Run `supabase/migrations/0002_rag_phase1.sql` (adds `chunks`, `embeddings`, `entries.processing_status`, and RLS policies scoping both new tables to the owning user via `entries`).
2. Install the Supabase CLI, then from the project root:

   ```
   supabase login
   supabase init          # creates supabase/config.toml if you don't have one
   supabase link --project-ref <your-project-ref>
   supabase functions deploy process-entry
   supabase secrets set OPENAI_API_KEY=sk-...
   ```

3. Set up the trigger — Supabase dashboard → Database → Webhooks → Create a new webhook:
   - Table: `entries`
   - Events: `INSERT`, `UPDATE`
   - Type: HTTP request → your deployed `process-entry` function URL
   - Headers: `Authorization: Bearer <service role key>` (Project Settings → API) — this is what lets the function recognize the call as trusted and skip the per-user ownership check it does for browser-triggered calls.

   Every entry save now triggers processing in the background; it doesn't block the save or depend on the tab staying open.

### Backfilling existing entries

Entries created before this phase existed sit at `processing_status = 'pending'`. Copy `scripts/.env.example` to `scripts/.env`, fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API — this key bypasses RLS, keep it out of the client `.env` and out of git), then:

```
node --env-file=scripts/.env scripts/reprocess-entries.mjs          # only non-complete entries
node --env-file=scripts/.env scripts/reprocess-entries.mjs --all    # everything, e.g. after a chunking change
```

### Sanity-checking chunk boundaries

Visit `/debug/chunks` while signed in. It lists your entries with their `processing_status`, and expanding one shows each chunk's text, length, and whether it has an embedding yet. There's also a per-entry "Reprocess" button for iterating on a single entry without running the full script.

## RAG pipeline — phase 2: structured metadata extraction

Each chunk now also gets tagged via a single structured-output call to `gpt-4o-mini` (`chunk_metadata` table): a dominant `emotion` (from a fixed 15-label vocabulary, so it stays filterable later instead of fragmenting into free-text variants), a `1-5` intensity, free-text `topics`, and free-text `entities`. This runs concurrently with embedding generation in the same Edge Function invocation, not after it — same trigger, same backfill script, same `/debug/chunks` view as phase 1, no new setup beyond the migration and redeploy.

The emotion vocabulary lives in `EMOTION_LABELS` in `supabase/functions/process-entry/index.ts` — worth reviewing once you've hand-checked a batch of extractions, since it directly determines what phase 4's `emotion = 'x'` filtering can match against later.

Per the plan: hand-check ~20 chunks in `/debug/chunks` against your own judgment before trusting these tags for anything downstream.

## RAG pipeline — phase 3: vector-only retrieval

A new `search-chunks` Edge Function embeds a natural-language query and ranks chunks by cosine similarity via a `match_chunks` Postgres function (`supabase/migrations/0004_rag_phase3.sql`). No structured filtering, no merging, no synthesis yet — just ranked chunks and their raw similarity scores.

Two things worth knowing about how this one's built, since it differs from phases 1-2:

- **It reads as the calling user, not the service role.** `match_chunks` is `security invoker`, so it runs with the caller's own permissions — the existing RLS policies on `chunks`/`embeddings` scope results to your own entries automatically. No manual `user_id` filtering needed, and no ownership-check code like `process-entry` has, since RLS already does that job for reads.
- **The embedding call is shared with `process-entry`** (`supabase/functions/_shared/openai.ts`), not duplicated — a query embedded with a different model than the chunks would make the similarity scores meaningless, so both functions are guaranteed to use the same one.

### Setup

```
supabase db push
supabase functions deploy search-chunks
supabase functions deploy process-entry   # redeploy — it now imports from _shared/openai.ts
```

No new secrets — reuses `OPENAI_API_KEY`.

### Trying it out

Visit `/debug/search` (linked from `/debug/chunks`) while signed in. Type a question, tune the similarity threshold and max results, and see the raw ranked chunks with their scores. The threshold defaults to `0.3` (`DEFAULT_SIMILARITY_THRESHOLD` in `supabase/functions/search-chunks/index.ts`) — a rough starting point from a quick spot-check against a handful of chunks, not a tuned value. Use this page to find a threshold that actually separates real matches from noise on your own data before phase 4 builds on top of it.

## RAG pipeline — phase 4: structured filtering + hybrid merge

A new `hybrid-search` Edge Function runs a structured filter (`filter_chunks`: emotion/entities/topics/date range against `chunk_metadata`) alongside vector search (`match_chunks`), merges the two result sets, and tags each result `vector`, `structured`, or `both` depending on which arm(s) found it. `/debug/search` now exposes both — it's the same page, extended, not a separate one. `search-chunks` (phase 3) is untouched and still deployed as a standalone pure-vector endpoint.

**Design choices worth flagging, since the phase spec left them to judgment:**

- **The two arms run independently and get unioned, not combined into one constrained query.** A chunk can match via vector similarity alone, structured filters alone, or both — that's what makes the source tagging in the debug UI meaningful. If filters were instead applied as a hard constraint *on* the vector search, there'd be nothing to distinguish.
- **Ranking: similarity when a query is involved, recency otherwise.** If you typed a question, everything in the merged set — including structured-only matches, which don't get a similarity score for free — gets scored against it via a new `score_chunks` RPC, so the whole set has one consistent ranking signal. Pure structured-filter searches (no query at all) have no similarity signal to rank by, so those fall back to entry recency.
- **"Nothing matched" is an explicit `{ matched: false, message }`, not just `results: []`.** `results` is still always present (empty when unmatched) so nothing breaks if calling code only checks array length, but the debug page branches on `matched` to show a clear message rather than an ambiguous blank list. Providing neither a query nor any filter is a separate, harder failure — a 400, not a zero-match response — since that's invalid input, not a search that legitimately found nothing.
- **Entity/topic filters use case-insensitive substring matching (`ILIKE ANY`), not exact match.** These are free-text LLM output (unlike the fixed emotion vocabulary), so "Grandma" vs "grandma" would otherwise silently fail to match. This doesn't fix deeper inconsistency like "Mr.Leslie" vs "Mr. Leslie" showing up as different strings across extractions — that's entity resolution, a real future problem (ties into the graph-layer idea from earlier), not something this filter tries to solve.

### Setup

```
supabase db push
supabase functions deploy hybrid-search
```

`match_chunks` changed shape (added `entry_created_at`) so the migration drops and recreates it — verified `search-chunks` still works unaffected afterward. No new secrets.

### Trying it out

`/debug/search` now has a structured filters panel (emotion toggles, comma-separated entities/topics, date range) below the query box — fill in a query, filters, or both. Each result shows a source badge (vector/structured/both) and its similarity score, or no score at all for a structured-only match against a filter-only search (nothing to compute a score against).

## RAG pipeline — phase 5: synthesis

A new `synthesize-answer` Edge Function takes a question plus phase 4's `matched`/`results` and produces a natural-language answer via `gpt-4o-mini`, or a plain "doesn't match" statement — never a forced answer. `/debug/search` gained a "Generate answer" button below the search results (needs a question, not just filters — synthesis has nothing to answer with filters alone). The answer renders above the result list, and any chunk it actually cited gets a "cited" badge in that list, so you can see exactly which of the retrieved chunks the answer is (and isn't) grounded in, right next to their text.

**Two things worth knowing about how "don't force an answer" is actually enforced — this isn't just a prompt instruction:**

- **`matched: false` short-circuits before any LLM call.** If phase 4 found nothing, the function returns a canned "doesn't match" response deterministically — 100% reliable, zero cost, no chance of the model second-guessing it into an answer anyway.
- **`matched: true` but weak/tangential chunks is a different, softer failure mode**, and there's no deterministic way to catch it — only the model can judge whether what it was given actually addresses the question. The schema forces it to say so explicitly (`grounded: false`) instead of stretching. I verified this works by deliberately feeding it real (sickness/AC-related) chunks against an unrelated question (tax law) — it correctly returned `grounded: false` rather than fabricating a connection.
- **Citations are checked, not trusted.** The model returns `cited_chunk_ids` alongside the answer; the function filters that list down to ids that actually exist in the chunks it was given, and if nothing survives that filter, the whole response is downgraded to `grounded: false` regardless of what the model claimed — an answer with no verifiable citation is exactly the untethered-summary problem this phase exists to prevent.

The system prompt is the actual tone enforcement (staying descriptive, never diagnostic/interpretive) — worth reading and adjusting directly in `supabase/functions/synthesize-answer/index.ts` if you see it drift, same as the emotion vocabulary in phase 2.

### Setup

```
supabase functions deploy synthesize-answer
```

No new secrets, no migration — this function does no database access at all (it only receives chunks as input, never queries for them), so it doesn't even need a Supabase client.

## RAG pipeline — phase 6: HyDE for the vector search leg

`hybrid-search`'s vector arm now embeds an LLM-generated hypothetical journal entry instead of the raw question by default — HyDE (Hypothetical Document Embeddings). Journal entries and questions are written in different voice/style, so a question like "times I felt like nothing I do matters" doesn't necessarily embed close to real diary-toned text expressing that feeling; a short first-person hypothetical entry written in that tone does. The structured filter arm (`filter_chunks`) is untouched.

**How it's kept safe and swappable:**

- **The embedding strategy is an isolated, swappable input**, not hardcoded — `supabase/functions/_shared/queryEmbeddingInput.ts` maps a strategy (`'hyde' | 'raw'`) to the text that actually gets embedded. `hybrid-search` accepts an optional `embeddingStrategy` in the request body (defaults to `'hyde'`) so raw-question and HyDE embedding can be A/B compared per-request without redeploying. `/debug/search` exposes this as a toggle.
- **The hypothetical text is never shown to the user or passed into synthesis.** It exists only to drive `match_chunks`; `synthesize-answer` still only ever sees the real retrieved chunk text, never the fabricated hypothetical.
- **HyDE generation runs concurrently with query extraction (phase 7)**, not before/after it — see phase 7 below for how the two legs stay decoupled all the way through.
- **Which strategy was used is logged per query** to a new `query_log` table (`supabase/migrations/0006_rag_phase6_hyde.sql`), along with the hypothetical text itself when HyDE was used, `matched`, and `result_count` — enough to compare HyDE vs. raw-question retrieval quality later. Logging is best-effort: a failed insert is caught and logged server-side, never surfaced as a search failure.

### Setup

```
supabase db push
supabase functions deploy hybrid-search
```

No new secrets — reuses `OPENAI_API_KEY`.

### Trying it out

`/debug/search` has a "Vector embedding strategy" toggle (HyDE / Raw question) next to the threshold and result-count controls. Run the same question against both and compare the ranked results and similarity scores — the result count line also shows which strategy actually produced that run's results.

## RAG pipeline — phase 7: automatic structured-filter extraction ("Prompt B")

The structured side of `hybrid-search` no longer requires hand-picked filters — `emotion`/`topics`/`entities` are now inferred from the question itself (e.g. "what are times I was sad" → `emotion: sadness`), merged with whatever filters were also supplied manually. Each field resolves independently: a question can populate `topics` with no `emotion` match, or vice versa. `date_range` is part of the extraction output shape but isn't actually populated yet — no Layer 1/2 rule for dates has been built.

**Two layers, keyword-first:**

- **Layer 1 (no LLM call).** `supabase/functions/_shared/emotionSynonyms.ts` matches the question against a synonym table seeded from the closed emotion vocabulary (phase 2) plus common synonyms ("sad"/"down"/"blue" → `sadness`). `supabase/functions/_shared/vocabMatch.ts` matches the question against topic/entity strings that already exist in the user's own `chunk_metadata`, via a new `match_known_vocab` Postgres function (`supabase/migrations/0007_rag_phase7_query_extraction.sql`) built on `pg_trgm`'s `word_similarity` — the right primitive for "does this known short term appear somewhere in this longer question", as opposed to whole-string similarity.
  - **Fixed in `supabase/migrations/0008_fix_vocab_match_short_terms.sql`:** `word_similarity` alone let short terms produce false positives — "mom" scored 0.75 against "sad moment" (it's a literal 3-character prefix of "moment"), well above the match threshold. No threshold value fixes this; short strings just don't carry enough trigram signal to separate a real match from a coincidental one. Terms of 5+ characters still fuzzy-match via `word_similarity`; shorter terms now require an exact whole-word match instead (same normalize-and-pad technique `matchEmotionKeyword` uses). Known tradeoff: this also stops fuzzy-catching some short-term variants (e.g. "job" no longer matches "jobs") — accepted in favor of not matching on coincidence.
- **Layer 2 (LLM fallback).** `supabase/functions/_shared/queryExtraction.ts` calls `gpt-4o-mini`, but only asks for whatever Layer 1 left unresolved — if Layer 1 resolved everything, this never runs. The emotion prompt is constrained to the exact 15-label enum and explicitly allowed to return `null` rather than force a mapping (verified: "times I felt weird about my job" resolves `topics: ['job']` via Layer 1, leaves `emotion: null` — "weird" doesn't map cleanly to any label).

**Kept decoupled from HyDE (phase 6), not sequenced after it:** `hybrid-search` starts HyDE generation and query extraction at the same time; the vector leg then waits only on HyDE's output and the structured-filter leg waits only on extraction's output, so neither leg is held up by however long the other's LLM call takes (`runVectorLeg`/`runFilterLeg` in `supabase/functions/hybrid-search/index.ts`).

**Logged per query, for tuning Layer 1 over time:** `query_log` (phase 6) gained `extracted_emotion`/`extracted_topics`/`extracted_entities` plus `emotion_resolved_by`/`topics_resolved_by`/`entities_resolved_by` (`'keyword' | 'llm'`) columns. If Layer 2 keeps resolving something Layer 1 should be catching, that's the signal to expand `emotionSynonyms.ts`.

### Setup

```
supabase db push
supabase functions deploy hybrid-search
```

No new secrets — reuses `OPENAI_API_KEY`.

### Trying it out

`/debug/search` has an "Auto-extract from question" checkbox in the structured filters panel (on by default — uncheck it to test manually-picked filters in isolation, the old phase-4 behavior). When extraction finds anything, a panel above the results shows each field's value and whether it came from the keyword layer or the LLM fallback.
