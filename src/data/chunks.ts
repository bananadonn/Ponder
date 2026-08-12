import { supabase } from '../lib/supabase'
import type { Chunk } from './types'

export async function listChunksForEntry(entryId: string): Promise<Chunk[]> {
  const { data, error } = await supabase
    .from('chunks')
    .select(
      'id, entry_id, chunk_index, text, created_at, embeddings(chunk_id), chunk_metadata(emotion, emotion_confidence, secondary_emotion, secondary_emotion_confidence, intensity, topics, entities)',
    )
    .eq('entry_id', entryId)
    .order('chunk_index', { ascending: true })

  if (error) throw error

  return data.map((row) => {
    const metadata = Array.isArray(row.chunk_metadata) ? row.chunk_metadata[0] : row.chunk_metadata

    return {
      id: row.id,
      entry_id: row.entry_id,
      chunk_index: row.chunk_index,
      text: row.text,
      created_at: row.created_at,
      has_embedding: Array.isArray(row.embeddings) && row.embeddings.length > 0,
      metadata: metadata ?? null,
    }
  })
}
