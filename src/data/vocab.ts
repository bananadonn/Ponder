import { supabase } from '../lib/supabase'

// Backs the Rack's topic/entity pickers. These RPCs already exist for
// query-extraction's constrained-vocabulary fallback (see
// supabase/functions/_shared/vocabMatch.ts) — security invoker, granted to
// `authenticated`, RLS-scoped to the calling user via the entries/chunks
// join, so they're safe to call directly from the client too.
export async function listKnownTopics(): Promise<string[]> {
  const { data, error } = await supabase.rpc('list_known_topics')
  if (error) throw error
  return (data ?? []).map((row: { topic: string }) => row.topic)
}

export async function listKnownEntities(): Promise<string[]> {
  const { data, error } = await supabase.rpc('list_known_entities')
  if (error) throw error
  return (data ?? []).map((row: { entity: string }) => row.entity)
}
