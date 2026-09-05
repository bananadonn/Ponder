import { generateHypotheticalEntry } from './hyde.ts'

// What actually gets embedded for the vector-search leg of a query is
// swappable per strategy, so raw-question and HyDE embedding can be A/B
// tested against each other later without branching logic scattered through
// the search function itself.
export type EmbeddingStrategy = 'raw' | 'hyde'

export const EMBEDDING_STRATEGIES: readonly EmbeddingStrategy[] = ['raw', 'hyde']
export const DEFAULT_EMBEDDING_STRATEGY: EmbeddingStrategy = 'hyde'

export function isEmbeddingStrategy(value: unknown): value is EmbeddingStrategy {
  return value === 'raw' || value === 'hyde'
}

export interface QueryEmbeddingInput {
  strategy: EmbeddingStrategy
  // The text that actually gets embedded. For 'hyde' this is a fabricated
  // hypothetical entry, never the user's real question — callers must only
  // use it for embedding, never surface it to the user or pass it into
  // synthesis.
  text: string
  // What generating `text` itself cost (0 for 'raw', which makes no LLM
  // call) — separate from whatever embedding it afterward costs.
  costUsd: number
}

export async function buildQueryEmbeddingInput(
  question: string,
  strategy: EmbeddingStrategy,
  apiKey: string,
): Promise<QueryEmbeddingInput> {
  if (strategy === 'hyde') {
    const { text, costUsd } = await generateHypotheticalEntry(question, apiKey)
    return { strategy, text, costUsd }
  }
  return { strategy, text: question, costUsd: 0 }
}
