import { supabase } from '../lib/supabase'
import type { EmbeddingStrategy, HybridFilters, HybridResult, QueryExtractionResult, SearchResult } from './types'

export interface SearchOptions {
  threshold?: number
  limit?: number
}

export async function searchChunks(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const { data, error } = await supabase.functions.invoke('search-chunks', {
    body: { query, threshold: options?.threshold, limit: options?.limit },
  })
  if (error) throw error
  return data.results
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
  return data
}
