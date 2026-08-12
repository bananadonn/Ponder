import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface VocabMatches {
  topics: string[]
  entities: string[]
}

const VOCAB_MATCH_THRESHOLD = 0.35

// Layer 1 of query extraction (phase 7): matches topic/entity strings
// already present in the user's own chunk_metadata against the question via
// the match_known_vocab RPC — no LLM call needed when this finds something.
// Terms of 5+ characters fuzzy-match via pg_trgm word_similarity (casing and
// minor wording differences don't prevent a match); shorter terms fall back
// to an exact whole-word match, since trigram similarity can't reliably
// tell a real short-term match from a coincidental one (e.g. "mom" scoring
// 0.75 against "sad moment" — see supabase/migrations/0008_fix_vocab_match_short_terms.sql).
export async function matchKnownVocab(client: SupabaseClient, question: string): Promise<VocabMatches> {
  const { data, error } = await client.rpc('match_known_vocab', {
    question,
    match_threshold: VOCAB_MATCH_THRESHOLD,
  })
  if (error) throw error

  const topics = new Set<string>()
  const entities = new Set<string>()
  for (const row of data ?? []) {
    if (row.kind === 'topic') topics.add(row.value)
    else if (row.kind === 'entity') entities.add(row.value)
  }
  return { topics: [...topics], entities: [...entities] }
}

// Backs Layer 2's constrained topic fallback (phase 7): the LLM picks from
// this closed list instead of generating freeform text, which previously
// let it echo the question back as a "topic" that matched nothing real.
export async function listKnownTopics(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.rpc('list_known_topics')
  if (error) throw error
  return (data ?? []).map((row: { topic: string }) => row.topic)
}

// Same fix as listKnownTopics, applied to entities: the LLM fallback picks
// from this closed list instead of inventing entity names that match
// nothing real.
export async function listKnownEntities(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.rpc('list_known_entities')
  if (error) throw error
  return (data ?? []).map((row: { entity: string }) => row.entity)
}
