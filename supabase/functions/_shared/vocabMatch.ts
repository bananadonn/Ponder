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

// Backs Layer 2's constrained topic/entity fallback (phase 7): the LLM
// picks from a closed list instead of generating freeform text, which
// previously let it echo the question back as a "topic" (or invent an
// entity) that matched nothing real. topics and entities use the same
// shape — a distinct RPC per field, returning that field's own column name.
async function listKnownVocab(
  client: SupabaseClient,
  rpcName: 'list_known_topics' | 'list_known_entities',
  column: 'topic' | 'entity',
): Promise<string[]> {
  const { data, error } = await client.rpc(rpcName)
  if (error) throw error
  return (data ?? []).map((row: Record<string, string>) => row[column])
}

export function listKnownTopics(client: SupabaseClient): Promise<string[]> {
  return listKnownVocab(client, 'list_known_topics', 'topic')
}

export function listKnownEntities(client: SupabaseClient): Promise<string[]> {
  return listKnownVocab(client, 'list_known_entities', 'entity')
}
