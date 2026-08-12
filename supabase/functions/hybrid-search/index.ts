import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { embedTexts } from '../_shared/openai.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  buildQueryEmbeddingInput,
  DEFAULT_EMBEDDING_STRATEGY,
  isEmbeddingStrategy,
  type EmbeddingStrategy,
  type QueryEmbeddingInput,
} from '../_shared/queryEmbeddingInput.ts'
import { extractQueryFilters, type QueryExtractionResult } from '../_shared/queryExtraction.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

// Same starting point as phase 3 — tune via the debug page, not here.
const DEFAULT_SIMILARITY_THRESHOLD = 0.3
const DEFAULT_VECTOR_LIMIT = 20
const DEFAULT_FILTER_LIMIT = 50

interface Filters {
  emotions?: string[]
  entities?: string[]
  topics?: string[]
  // Explicit-UI-only: never inferred from question text. "august"/"may" can
  // be a month or a name, and "yesterday" can be a date constraint or the
  // actual topic of the question ("times I reflected on yesterday") — that
  // ambiguity isn't fixable by better parsing, so date filtering only ever
  // comes from a person setting it directly (see the date-range narrowing
  // step in the main handler below).
  startDate?: string
  endDate?: string
}

interface RequestBody {
  query?: string
  threshold?: number
  vectorLimit?: number
  filters?: Filters
  filterLimit?: number
  // Which text gets embedded for the vector leg — 'hyde' (default) embeds an
  // LLM-generated hypothetical entry instead of the raw question; 'raw'
  // embeds the question as-is. Overridable per-request for A/B comparison.
  embeddingStrategy?: string
  // Whether structured filters get auto-inferred from `query` (phase 7),
  // merged with any manually-supplied `filters`. Defaults to true; set
  // false to test `filters` in isolation, the way the debug page did before
  // extraction existed.
  autoExtractFilters?: boolean
}

type Source = 'vector' | 'structured' | 'both'

interface MergedResult {
  chunk_id: string
  entry_id: string
  chunk_index: number
  text: string
  entry_created_at: string
  similarity: number | null
  source: Source
}

function hasActiveFilters(filters?: Filters): boolean {
  if (!filters) return false
  return Boolean(
    (filters.emotions && filters.emotions.length > 0) ||
      (filters.entities && filters.entities.length > 0) ||
      (filters.topics && filters.topics.length > 0) ||
      filters.startDate ||
      filters.endDate,
  )
}

interface FilterRow {
  chunk_id: string
  entry_id: string
  chunk_index: number
  text: string
  entry_created_at: string
}

async function fetchFilterMatches(client: SupabaseClient, filters: Filters, matchCount: number): Promise<FilterRow[]> {
  const { data, error } = await client.rpc('filter_chunks', {
    filter_emotions: filters.emotions?.length ? filters.emotions : null,
    filter_entities: filters.entities?.length ? filters.entities : null,
    filter_topics: filters.topics?.length ? filters.topics : null,
    filter_start: filters.startDate ?? null,
    filter_end: filters.endDate ?? null,
    match_count: matchCount,
  })
  if (error) throw error
  return data ?? []
}

interface VectorRow {
  chunk_id: string
  entry_id: string
  chunk_index: number
  text: string
  entry_created_at: string
  similarity: number
}

interface VectorLegResult {
  rows: VectorRow[]
  queryEmbedding: number[]
  embeddingInput: QueryEmbeddingInput
}

// Waits only on its own embedding input, not on query extraction — so this
// leg starts embedding/searching as soon as HyDE (or the raw question) is
// ready, rather than being held up by however long extraction takes.
async function runVectorLeg(
  client: SupabaseClient,
  embeddingInputPromise: Promise<QueryEmbeddingInput>,
  threshold: number,
  vectorLimit: number,
  apiKey: string,
): Promise<VectorLegResult> {
  const embeddingInput = await embeddingInputPromise
  const [queryEmbedding] = await embedTexts([embeddingInput.text], apiKey)

  const { data, error } = await client.rpc('match_chunks', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: vectorLimit,
  })
  if (error) throw error

  return { rows: data ?? [], queryEmbedding, embeddingInput }
}

interface FilterLegResult {
  rows: FilterRow[] | null
  filtersActive: boolean
  extraction: QueryExtractionResult | null
}

// Waits only on its own extraction promise, not on HyDE — this leg queries
// filter_chunks as soon as extraction (which runs concurrently with HyDE)
// resolves.
//
// Manually-supplied filters are AND-combined in one filter_chunks call —
// that's deliberate intent when a person sets multiple filters on purpose.
// Auto-extracted fields are NOT folded into that same AND'd call: each
// independently-resolved field (emotion, topics, entities) gets its own
// filter_chunks call, and the row sets are unioned. Extraction is a
// fallible guess per field, not a deliberate joint constraint — a bad guess
// on one field (e.g. a fabricated topic) must not veto a correct match on
// another (e.g. a correctly keyword-matched emotion). Manual filters and
// each extracted field can therefore surface a chunk independently; a chunk
// matched by any one of them is included.
async function runFilterLeg(
  client: SupabaseClient,
  manualFilters: Filters | undefined,
  extractionPromise: Promise<QueryExtractionResult> | null,
  filterLimit: number,
): Promise<FilterLegResult> {
  const extraction = extractionPromise ? await extractionPromise : null

  const subQueries: Promise<FilterRow[]>[] = []
  if (hasActiveFilters(manualFilters)) {
    subQueries.push(fetchFilterMatches(client, manualFilters!, filterLimit))
  }
  if (extraction && extraction.emotion.value.length > 0) {
    subQueries.push(fetchFilterMatches(client, { emotions: extraction.emotion.value }, filterLimit))
  }
  if (extraction && extraction.topics.value.length > 0) {
    subQueries.push(fetchFilterMatches(client, { topics: extraction.topics.value }, filterLimit))
  }
  if (extraction && extraction.entities.value.length > 0) {
    subQueries.push(fetchFilterMatches(client, { entities: extraction.entities.value }, filterLimit))
  }

  if (subQueries.length === 0) {
    return { rows: null, filtersActive: false, extraction }
  }

  const resultSets = await Promise.all(subQueries)

  // Dedupe by chunk_id — the same chunk can legitimately turn up in more
  // than one sub-query (e.g. matches both the emotion query and the topics
  // query). Collapsing here keeps the downstream vector/structured "both"
  // tagging correct: it only means "also matched a structured sub-query",
  // not "matched N of them".
  const deduped = new Map<string, FilterRow>()
  for (const rows of resultSets) {
    for (const row of rows) {
      if (!deduped.has(row.chunk_id)) deduped.set(row.chunk_id, row)
    }
  }

  return { rows: [...deduped.values()], filtersActive: true, extraction }
}

interface QueryLogEntry {
  query: string
  embeddingStrategy: EmbeddingStrategy
  hydeText: string | null
  matched: boolean
  resultCount: number
  extraction: QueryExtractionResult | null
}

// Records which embedding strategy produced a given result set, and which
// layer resolved each extracted field, so both can be compared/tuned later
// (HyDE vs. raw-question retrieval quality; keyword layer vs. LLM fallback
// hit rate). Callers should treat this as best-effort — a logging failure
// must never fail the search itself.
async function logQuery(client: SupabaseClient, entry: QueryLogEntry): Promise<void> {
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData?.user) return

  const { error } = await client.from('query_log').insert({
    user_id: userData.user.id,
    query: entry.query,
    embedding_strategy: entry.embeddingStrategy,
    hyde_text: entry.hydeText,
    matched: entry.matched,
    result_count: entry.resultCount,
    extracted_emotion: entry.extraction?.emotion.value ?? null,
    extracted_topics: entry.extraction?.topics.value ?? null,
    extracted_entities: entry.extraction?.entities.value ?? null,
    emotion_resolved_by: entry.extraction?.emotion.resolvedBy ?? null,
    topics_resolved_by: entry.extraction?.topics.resolvedBy ?? null,
    entities_resolved_by: entry.extraction?.entities.resolvedBy ?? null,
  })
  if (error) throw error
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const query = body.query?.trim() || null

  if (!query && !hasActiveFilters(body.filters)) {
    return new Response(JSON.stringify({ error: 'Provide a query and/or at least one filter.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const threshold = body.threshold ?? DEFAULT_SIMILARITY_THRESHOLD
  const vectorLimit = body.vectorLimit ?? DEFAULT_VECTOR_LIMIT
  const filterLimit = body.filterLimit ?? DEFAULT_FILTER_LIMIT
  const autoExtractFilters = body.autoExtractFilters ?? true

  // Runs as the calling user — RLS scopes every RPC below to their own data.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  try {
    const embeddingStrategy: EmbeddingStrategy = isEmbeddingStrategy(body.embeddingStrategy)
      ? body.embeddingStrategy
      : DEFAULT_EMBEDDING_STRATEGY

    // HyDE generation (Prompt A) and query extraction (Prompt B) don't
    // depend on each other's output, so both start immediately. Each
    // downstream leg (vector search, structured filter) then waits only on
    // the one promise it actually needs, not both — so e.g. the vector leg
    // isn't held up by however long extraction's LLM fallback takes.
    const embeddingInputPromise = query ? buildQueryEmbeddingInput(query, embeddingStrategy, OPENAI_API_KEY) : null
    const extractionPromise =
      query && autoExtractFilters ? extractQueryFilters(userClient, query, OPENAI_API_KEY) : null

    const [vectorLeg, filterLeg] = await Promise.all([
      embeddingInputPromise
        ? runVectorLeg(userClient, embeddingInputPromise, threshold, vectorLimit, OPENAI_API_KEY)
        : Promise.resolve(null),
      runFilterLeg(userClient, body.filters, extractionPromise, filterLimit),
    ])

    const merged = new Map<string, MergedResult>()

    if (vectorLeg) {
      for (const row of vectorLeg.rows) {
        merged.set(row.chunk_id, {
          chunk_id: row.chunk_id,
          entry_id: row.entry_id,
          chunk_index: row.chunk_index,
          text: row.text,
          entry_created_at: row.entry_created_at,
          similarity: row.similarity,
          source: 'vector',
        })
      }
    }

    if (filterLeg.rows) {
      for (const row of filterLeg.rows) {
        const existing = merged.get(row.chunk_id)
        if (existing) {
          existing.source = 'both'
        } else {
          merged.set(row.chunk_id, {
            chunk_id: row.chunk_id,
            entry_id: row.entry_id,
            chunk_index: row.chunk_index,
            text: row.text,
            entry_created_at: row.entry_created_at,
            similarity: null,
            source: 'structured',
          })
        }
      }
    }

    // Explicit date range (UI-only — never inferred from `query`) narrows
    // the *entire* merged set, vector-sourced rows included. This runs
    // after vector/structured are merged, not as one more filter_chunks
    // sub-query unioned in above, specifically so it also catches vector
    // matches outside the window — those would otherwise leak through
    // untouched by date entirely, since the vector leg has no date
    // awareness of its own. It plays no part in retrieval or scoring; it's
    // a pure post-filter.
    if (body.filters?.startDate || body.filters?.endDate) {
      const start = body.filters.startDate ? new Date(body.filters.startDate).getTime() : -Infinity
      const end = body.filters.endDate ? new Date(body.filters.endDate).getTime() : Infinity
      for (const [chunkId, row] of merged) {
        const createdAt = new Date(row.entry_created_at).getTime()
        if (createdAt < start || createdAt > end) merged.delete(chunkId)
      }
    }

    // Structured-only matches have no similarity yet. If there's a query at
    // all, score them against it too, so ranking has one consistent signal
    // instead of mixing scored (vector-arm) and unscored (structured-only)
    // results.
    const queryEmbedding = vectorLeg?.queryEmbedding ?? null
    if (queryEmbedding) {
      const unscoredIds = [...merged.values()].filter((r) => r.similarity === null).map((r) => r.chunk_id)
      if (unscoredIds.length > 0) {
        const { data, error } = await userClient.rpc('score_chunks', {
          chunk_ids: unscoredIds,
          query_embedding: queryEmbedding,
        })
        if (error) throw error
        for (const row of data ?? []) {
          const entry = merged.get(row.chunk_id)
          if (entry) entry.similarity = row.similarity
        }
      }
    }

    // Rank by similarity when a query was involved (the more meaningful
    // relevance signal); fall back to recency for pure structured-filter
    // searches, where there's no similarity signal at all. A result can
    // also end up with a null similarity even when a query was involved —
    // score_chunks inner-joins to embeddings, so a matched chunk with
    // chunk_metadata but no embeddings row would silently get no score.
    // process-entry's normal insert order (embeddings, then chunk_metadata)
    // doesn't actually produce that combination today, but nothing in the
    // schema ties the two tables' existence together either, so it's not
    // ruled out by anything besides current app behavior. Comparing those
    // against scored results by recency instead — as opposed to always
    // ranking them below every scored result — would make the comparator
    // non-transitive (Array.sort's behavior is undefined without
    // transitivity), so "has a score" always outranks "doesn't", and
    // recency only breaks ties within each of those two groups.
    const results = [...merged.values()].sort((a, b) => {
      if (a.similarity != null && b.similarity != null) {
        if (a.similarity !== b.similarity) return b.similarity - a.similarity
      } else if (a.similarity != null || b.similarity != null) {
        return a.similarity != null ? -1 : 1
      }
      return new Date(b.entry_created_at).getTime() - new Date(a.entry_created_at).getTime()
    })

    if (query) {
      try {
        await logQuery(userClient, {
          query,
          embeddingStrategy,
          hydeText: vectorLeg?.embeddingInput.strategy === 'hyde' ? vectorLeg.embeddingInput.text : null,
          matched: results.length > 0,
          resultCount: results.length,
          extraction: filterLeg.extraction,
        })
      } catch (err) {
        console.error('query_log insert failed', err)
      }
    }

    const filtersActive = filterLeg.filtersActive

    if (results.length === 0) {
      return new Response(
        JSON.stringify({
          matched: false,
          results: [],
          embeddingStrategy,
          extractedFilters: filterLeg.extraction,
          message: query
            ? 'No chunks matched the filters or scored above the similarity threshold.'
            : 'No chunks matched the given filters.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        matched: true,
        results,
        threshold,
        filtersActive,
        embeddingStrategy,
        extractedFilters: filterLeg.extraction,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
