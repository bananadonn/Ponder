export type ProcessingStatus = 'pending' | 'processing' | 'complete' | 'failed'

export interface Entry {
  id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
  processing_status: ProcessingStatus
}

export type NewEntry = Pick<Entry, 'content'> & {
  metadata?: Entry['metadata']
}

export type EntryUpdate = Partial<Pick<Entry, 'content' | 'metadata'>>

export interface ChunkMetadata {
  emotion: string | null
  emotion_confidence: number | null
  secondary_emotion: string | null
  secondary_emotion_confidence: number | null
  intensity: number | null
  topics: string[] | null
  entities: string[] | null
}

export interface Chunk {
  id: string
  entry_id: string
  chunk_index: number
  text: string
  created_at: string
  has_embedding: boolean
  metadata: ChunkMetadata | null
}

export interface SearchResult {
  chunk_id: string
  entry_id: string
  chunk_index: number
  text: string
  similarity: number
}

export type ResultSource = 'vector' | 'structured' | 'both'

// Mirrors EmbeddingStrategy in supabase/functions/_shared/queryEmbeddingInput.ts.
// 'hyde' embeds an LLM-generated hypothetical journal entry for the vector
// leg instead of the raw question; 'raw' embeds the question as-is.
export type EmbeddingStrategy = 'raw' | 'hyde'

export interface HybridResult {
  chunk_id: string
  entry_id: string
  chunk_index: number
  text: string
  entry_created_at: string
  similarity: number | null
  source: ResultSource
}

export interface HybridFilters {
  emotions?: string[]
  entities?: string[]
  topics?: string[]
  // Explicit-UI-only — never inferred from question text (see
  // supabase/functions/hybrid-search/index.ts). Narrows the whole merged
  // result set (vector matches included), not just the structured leg.
  startDate?: string
  endDate?: string
}

export interface SynthesisResult {
  grounded: boolean
  answer: string
  cited_chunk_ids: string[]
}

// Mirrors ResolvedBy/ExtractedField/QueryExtractionResult in
// supabase/functions/_shared/queryExtraction.ts (phase 7). Each structured
// filter field resolves independently, either via the keyword/fuzzy-vocab
// layer (no LLM call) or the LLM fallback — never both.
export type ResolvedBy = 'keyword' | 'llm'

export interface ExtractedField<T> {
  value: T
  resolvedBy: ResolvedBy
}

export interface QueryExtractionResult {
  emotion: ExtractedField<string[]>
  topics: ExtractedField<string[]>
  entities: ExtractedField<string[]>
}
