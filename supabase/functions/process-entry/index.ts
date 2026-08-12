import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { chunkContent } from '../_shared/chunking.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { EMBEDDING_MODEL, embedTexts } from '../_shared/openai.ts'
import { EMOTION_LABELS } from '../_shared/emotionLabels.ts'

// extractAllMetadata fires one concurrent OpenAI call per paragraph
// (Promise.all, no concurrency limit) — unbounded input length means
// unbounded concurrent requests, worse if a double-reprocess races with
// itself. This caps total entry length generously enough that no realistic
// journal entry ever hits it (~8,000 words), while still bounding the
// worst case to something that can't overwhelm the Edge Function or OpenAI
// rate limits.
const MAX_CONTENT_LENGTH = 40_000

// Bump this manually if chunking or embedding logic changes in a way that
// warrants re-embedding everything (tracked here, not by OpenAI).
const EMBEDDING_VERSION = 'v1'

const EXTRACTION_MODEL = 'gpt-4o-mini'
// Bump if the extraction prompt/schema changes enough to warrant re-tagging.
const EXTRACTION_VERSION = 'v1'

const EXTRACTION_SYSTEM_PROMPT = `You extract structured metadata from a short excerpt of a personal journal entry.

- emotion: the single dominant emotion expressed, chosen from the provided list (pick the closest match even if imperfect)
- emotion_confidence: your confidence in that label, from 0 (low) to 1 (high)
- intensity: how strongly the emotion is expressed, from 1 (barely present) to 5 (overwhelming)
- topics: concrete short noun phrases for what's being discussed
- entities: proper nouns only — people, places, organizations mentioned by name

Base everything strictly on what is explicitly written. Do not infer a diagnosis or read between the lines.`

interface ExtractedMetadata {
  emotion: string
  emotion_confidence: number
  intensity: number
  topics: string[]
  entities: string[]
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function extractMetadata(text: string): Promise<ExtractedMetadata> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'chunk_metadata',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              emotion: { type: 'string', enum: EMOTION_LABELS },
              emotion_confidence: {
                type: 'number',
                description: 'Confidence in the emotion label, from 0 (low) to 1 (high).',
              },
              intensity: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              topics: { type: 'array', items: { type: 'string' } },
              entities: { type: 'array', items: { type: 'string' } },
            },
            required: ['emotion', 'emotion_confidence', 'intensity', 'topics', 'entities'],
            additionalProperties: false,
          },
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI extraction request failed: ${response.status} ${await response.text()}`)
  }

  const json = await response.json()
  return JSON.parse(json.choices[0].message.content)
}

async function extractAllMetadata(texts: string[]): Promise<ExtractedMetadata[]> {
  return Promise.all(texts.map(extractMetadata))
}

async function processEntry(entryId: string) {
  const { data: entry, error: fetchError } = await admin
    .from('entries')
    .select('id, content')
    .eq('id', entryId)
    .single()

  if (fetchError || !entry) {
    throw new Error(`Entry not found: ${entryId}`)
  }

  if (entry.content.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      `Entry content too long to process (${entry.content.length} chars, max ${MAX_CONTENT_LENGTH})`,
    )
  }

  await admin.from('entries').update({ processing_status: 'processing' }).eq('id', entryId)

  // Reprocessing: clear any prior chunks (embeddings cascade with them).
  await admin.from('chunks').delete().eq('entry_id', entryId)

  const paragraphs = chunkContent(entry.content)

  if (paragraphs.length === 0) {
    await admin.from('entries').update({ processing_status: 'complete' }).eq('id', entryId)
    return { chunkCount: 0 }
  }

  const { data: insertedChunks, error: insertChunksError } = await admin
    .from('chunks')
    .insert(paragraphs.map((text, chunk_index) => ({ entry_id: entryId, chunk_index, text })))
    .select('id, chunk_index')

  if (insertChunksError || !insertedChunks) {
    throw new Error(`Failed to insert chunks: ${insertChunksError?.message}`)
  }

  // Embedding and metadata extraction are independent LLM calls over the
  // same chunks — run them concurrently rather than one after the other.
  const [embeddingsByChunkIndex, metadataByChunkIndex] = await Promise.all([
    embedTexts(paragraphs, OPENAI_API_KEY),
    extractAllMetadata(paragraphs),
  ])

  const embeddingRows = insertedChunks.map(({ id, chunk_index }: { id: string; chunk_index: number }) => ({
    chunk_id: id,
    vector: embeddingsByChunkIndex[chunk_index],
    embedding_model: EMBEDDING_MODEL,
    embedding_version: EMBEDDING_VERSION,
  }))

  const { error: insertEmbeddingsError } = await admin.from('embeddings').insert(embeddingRows)
  if (insertEmbeddingsError) {
    throw new Error(`Failed to insert embeddings: ${insertEmbeddingsError.message}`)
  }

  const metadataRows = insertedChunks.map(({ id, chunk_index }: { id: string; chunk_index: number }) => {
    const m = metadataByChunkIndex[chunk_index]
    return {
      chunk_id: id,
      emotion: m.emotion,
      emotion_confidence: m.emotion_confidence,
      intensity: m.intensity,
      topics: m.topics,
      entities: m.entities,
      extraction_model: EXTRACTION_MODEL,
      extraction_version: EXTRACTION_VERSION,
    }
  })

  const { error: insertMetadataError } = await admin.from('chunk_metadata').insert(metadataRows)
  if (insertMetadataError) {
    throw new Error(`Failed to insert chunk metadata: ${insertMetadataError.message}`)
  }

  await admin.from('entries').update({ processing_status: 'complete' }).eq('id', entryId)
  return { chunkCount: insertedChunks.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let body: {
    type?: string
    record?: { id?: string; content?: string }
    old_record?: { content?: string }
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const entryId = body.record?.id
  if (!entryId) {
    return new Response(JSON.stringify({ error: 'Missing record.id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // This function writes processing_status back to `entries`, which is one
  // of the columns the webhook watches — without this check, that write
  // re-fires the webhook, which re-triggers this function, indefinitely.
  // Only reprocess UPDATEs where content actually changed; status-only
  // writes (ours) and metadata-only writes are ignored. INSERTs and
  // manual/script invocations (no old_record) always proceed.
  if (body.type === 'UPDATE' && body.old_record && body.record?.content === body.old_record.content) {
    return new Response(JSON.stringify({ ok: true, skipped: 'content unchanged' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Trusted callers (the DB webhook, the manual reprocess script) authenticate
  // with the service role key. Anything else is treated as a browser-side
  // user session and must be verified to actually own this entry, since RLS
  // doesn't protect this HTTP endpoint the way it protects direct table access.
  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  const isTrustedCaller = callerToken === SERVICE_ROLE_KEY

  if (!isTrustedCaller) {
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: ownEntry } = await callerClient.from('entries').select('id').eq('id', entryId).maybeSingle()

    if (!ownEntry) {
      return new Response(JSON.stringify({ error: 'Entry not found or not owned by caller' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  try {
    const result = await processEntry(entryId)
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    await admin.from('entries').update({ processing_status: 'failed' }).eq('id', entryId)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
