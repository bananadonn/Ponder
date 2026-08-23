import { supabase } from '../lib/supabase'
import { decryptOrPassthrough } from '../lib/crypto'
import { getSessionDek } from '../lib/sessionKey'
import type { EmbeddingStrategy, HybridFilters, HybridResult, QueryExtractionResult, SearchResult } from './types'

export interface SearchOptions {
  threshold?: number
  limit?: number
}

export interface ChunkMatch {
  chunk_id: string
  entry_id: string
  chunk_index: number
  text: string
  entry_created_at: string
}

// filter_chunks lost its filter_text parameter once chunks.text became
// ciphertext (server-side ILIKE can't match encrypted bytes) -- widened
// here (not as the SQL default, which reflect also relies on) to
// compensate for substring-filtering now happening client-side, after this
// recency-ordered LIMIT rather than before it.
const SUBSTRING_CANDIDATE_LIMIT = 200

// Live-as-you-type substring search for Retrieval mode, constrained by
// whatever Rack filters are active. Calls filter_chunks directly (it's
// security-invoker and granted to `authenticated`, same as the known-vocab
// RPCs) instead of going through the hybrid-search edge function — no
// embeddings/OpenAI call needed. Pressing Enter escalates to hybridSearch
// below for the real vector-embedding pass over the same filters.
//
// The actual substring match now happens client-side (decrypt each
// metadata-filtered candidate, then a plain case-insensitive .includes()):
// chunks.text is encrypted at rest, so Postgres can no longer ILIKE it
// server-side. Accepted tradeoff: matches are found within the top
// SUBSTRING_CANDIDATE_LIMIT candidates by recency, not a true full-text
// scan of every chunk that matches the active filters.
export async function searchChunksSubstring(text: string, filters?: HybridFilters): Promise<ChunkMatch[]> {
  const { data, error } = await supabase.rpc('filter_chunks', {
    filter_emotions: filters?.emotions?.length ? filters.emotions : null,
    filter_entities: filters?.entities?.length ? filters.entities : null,
    filter_topics: filters?.topics?.length ? filters.topics : null,
    filter_start: filters?.startDate ?? null,
    filter_end: filters?.endDate ?? null,
    match_count: SUBSTRING_CANDIDATE_LIMIT,
  })
  if (error) throw error
  const candidates: ChunkMatch[] = data ?? []
  if (candidates.length === 0) return []

  const dek = await getSessionDek()
  const decrypted = await Promise.all(
    candidates.map(async (c) => ({ ...c, text: (await decryptOrPassthrough(dek, c.text))! })),
  )

  const needle = text.trim().toLowerCase()
  if (!needle) return decrypted
  return decrypted.filter((c) => c.text.toLowerCase().includes(needle))
}

export async function searchChunks(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const { data, error } = await supabase.functions.invoke('search-chunks', {
    body: { query, threshold: options?.threshold, limit: options?.limit },
  })
  if (error) throw error
  const dek = await getSessionDek()
  return Promise.all(
    data.results.map(async (r: SearchResult) => ({ ...r, text: (await decryptOrPassthrough(dek, r.text))! })),
  )
}

export interface HybridSearchOptions {
  threshold?: number
  vectorLimit?: number
  filterLimit?: number
  // Overrides the default vector-leg embedding strategy (server defaults to
  // 'hyde'). Pass explicitly to A/B compare 'raw' vs 'hyde' retrieval.
  embeddingStrategy?: EmbeddingStrategy
  // Auto-infers structured filters (emotion/topics/entities) from `query`
  // and merges them with `filters` (server defaults to true). Pass false to
  // test manually-supplied `filters` in isolation.
  autoExtractFilters?: boolean
}

export interface HybridSearchResponse {
  matched: boolean
  results: HybridResult[]
  message?: string
  embeddingStrategy: EmbeddingStrategy
  extractedFilters: QueryExtractionResult | null
}

export async function hybridSearch(
  query: string,
  filters?: HybridFilters,
  options?: HybridSearchOptions,
): Promise<HybridSearchResponse> {
  const { data, error } = await supabase.functions.invoke('hybrid-search', {
    body: {
      query: query || undefined,
      filters,
      threshold: options?.threshold,
      vectorLimit: options?.vectorLimit,
      filterLimit: options?.filterLimit,
      embeddingStrategy: options?.embeddingStrategy,
      autoExtractFilters: options?.autoExtractFilters,
    },
  })
  if (error) throw error
  if (!data.matched) return data

  const dek = await getSessionDek()
  const results = await Promise.all(
    data.results.map(async (r: HybridResult) => ({ ...r, text: (await decryptOrPassthrough(dek, r.text))! })),
  )
  return { ...data, results }
}
