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
const EXTRACTION_VERSION = 'v2'

const EXTRACTION_SYSTEM_PROMPT = `You extract structured metadata from a short excerpt of a personal journal entry.

- emotion: the single dominant emotion expressed, chosen from the provided list (pick the closest match even if imperfect)
- emotion_confidence: your confidence in that label, from 0 (low) to 1 (high)
- secondary_emotion: a second emotion, only if another emotion is ALSO clearly and separately expressed alongside the dominant one (e.g. "proud but anxious about what's next") — chosen from the same provided list. Null if only one emotion is really present; do not force a second pick just to fill the field.
- secondary_emotion_confidence: your confidence in secondary_emotion, from 0 (low) to 1 (high). Null if secondary_emotion is null.
- intensity: how strongly the dominant emotion is expressed, from 1 (barely present) to 5 (overwhelming)
- topics: concrete short noun phrases for what's being discussed
- entities: proper nouns only — people, places, organizations mentioned by name

Base everything strictly on what is explicitly written. Do not infer a diagnosis or read between the lines.`

interface ExtractedMetadata {
  emotion: string
  emotion_confidence: number
  secondary_emotion: string | null
  secondary_emotion_confidence: number | null
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
              secondary_emotion: {
                type: ['string', 'null'],
                enum: [...EMOTION_LABELS, null],
                description:
                  'A second emotion, only if clearly and separately expressed alongside the dominant one. Null if only one emotion is present.',
              },
              secondary_emotion_confidence: {
                type: ['number', 'null'],
                description: 'Confidence in secondary_emotion, from 0 (low) to 1 (high). Null if secondary_emotion is null.',
              },
              intensity: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              topics: { type: 'array', items: { type: 'string' } },
              entities: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'emotion',
              'emotion_confidence',
              'secondary_emotion',
              'secondary_emotion_confidence',
              'intensity',
              'topics',
              'entities',
            ],
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

interface ReusableChunk {
  vector: number[]
  embeddingModel: string
  embeddingVersion: string
  metadata: ExtractedMetadata
  extractionModel: string
  extractionVersion: string
}

interface ExistingMetadataRow extends ExtractedMetadata {
  chunk_id: string
  extraction_model: string
  extraction_version: string
}

interface ExistingEmbeddingRow {
  chunk_id: string
  vector: unknown
  embedding_model: string
  embedding_version: string
}

// pgvector columns can come back from PostgREST either as a real array or
// as their text representation ("[0.1,0.2,...]", which happens to be valid
// JSON) depending on client/driver version — handle both.
function parseVector(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[]
  if (typeof v === 'string') return JSON.parse(v)
  throw new Error('Unexpected embedding vector format from DB')
}

// Most saves only change one paragraph out of many. Rather than re-embed
// and re-tag every paragraph on every save, capture the embedding +
// metadata of any existing chunk whose text is byte-for-byte unchanged (and
// was computed with the current model/prompt versions — a version bump
// still forces a full recompute, same as before this function existed) so
// it can be reused instead of paying for a fresh OpenAI call.
async function loadReusableChunks(entryId: string): Promise<Map<string, ReusableChunk[]>> {
  const reuseByText = new Map<string, ReusableChunk[]>()

  const { data: existingChunks } = await admin.from('chunks').select('id, text').eq('entry_id', entryId)
  if (!existingChunks || existingChunks.length === 0) return reuseByText

  const chunkIds = existingChunks.map(({ id }: { id: string }) => id)
  const [{ data: existingEmbeddings }, { data: existingMetadata }] = await Promise.all([
    admin
      .from('embeddings')
      .select('chunk_id, vector, embedding_model, embedding_version')
      .in('chunk_id', chunkIds),
    admin
      .from('chunk_metadata')
      .select(
        'chunk_id, emotion, emotion_confidence, secondary_emotion, secondary_emotion_confidence, intensity, topics, entities, extraction_model, extraction_version',
      )
      .in('chunk_id', chunkIds),
  ])

  const embeddingByChunkId = new Map<string, ExistingEmbeddingRow>(
    (existingEmbeddings ?? []).map((e: ExistingEmbeddingRow) => [e.chunk_id, e]),
  )
  const metadataByChunkId = new Map<string, ExistingMetadataRow>(
    (existingMetadata ?? []).map((m: ExistingMetadataRow) => [m.chunk_id, m]),
  )

  for (const chunk of existingChunks as { id: string; text: string }[]) {
    const embedding = embeddingByChunkId.get(chunk.id)
    const metadata = metadataByChunkId.get(chunk.id)
    if (
      !embedding ||
      !metadata ||
      embedding.embedding_model !== EMBEDDING_MODEL ||
      embedding.embedding_version !== EMBEDDING_VERSION ||
      metadata.extraction_model !== EXTRACTION_MODEL ||
      metadata.extraction_version !== EXTRACTION_VERSION
    ) {
      continue
    }

    const queue = reuseByText.get(chunk.text) ?? []
    queue.push({
      vector: parseVector(embedding.vector),
      embeddingModel: embedding.embedding_model,
      embeddingVersion: embedding.embedding_version,
      metadata: {
        emotion: metadata.emotion,
        emotion_confidence: metadata.emotion_confidence,
        secondary_emotion: metadata.secondary_emotion,
        secondary_emotion_confidence: metadata.secondary_emotion_confidence,
        intensity: metadata.intensity,
        topics: metadata.topics,
        entities: metadata.entities,
      },
      extractionModel: metadata.extraction_model,
      extractionVersion: metadata.extraction_version,
    })
    reuseByText.set(chunk.text, queue)
  }

  return reuseByText
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

  const paragraphs = chunkContent(entry.content)

  // Capture anything reusable from the current chunks before wiping them.
  const reuseByText = await loadReusableChunks(entryId)

  // Reprocessing: clear any prior chunks (embeddings cascade with them).
  await admin.from('chunks').delete().eq('entry_id', entryId)

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

  // Reuse a matching existing chunk's embedding/metadata by exact text match
  // (a queue per text, so duplicate paragraphs each get their own prior
  // record); anything left over needs a fresh OpenAI call.
  const reused = new Map<number, ReusableChunk>()
  const freshIndexes: number[] = []
  paragraphs.forEach((text, chunk_index) => {
    const match = reuseByText.get(text)?.shift()
    if (match) {
      reused.set(chunk_index, match)
    } else {
      freshIndexes.push(chunk_index)
    }
  })

  console.log(
    `process-entry ${entryId}: ${freshIndexes.length} fresh, ${reused.size} reused of ${paragraphs.length} paragraphs`,
  )

  const freshTexts = freshIndexes.map((i) => paragraphs[i])

  // Embedding and metadata extraction are independent LLM calls over the
  // same chunks — run them concurrently rather than one after the other.
  // Skipped entirely when every paragraph was reused.
  const [freshEmbeddings, freshMetadata] =
    freshTexts.length > 0
      ? await Promise.all([embedTexts(freshTexts, OPENAI_API_KEY), extractAllMetadata(freshTexts)])
      : [[] as number[][], [] as ExtractedMetadata[]]

  const embeddingByChunkIndex = new Map<
    number,
    { vector: number[]; embedding_model: string; embedding_version: string }
  >()
  const metadataByChunkIndex = new Map<
    number,
    ExtractedMetadata & { extraction_model: string; extraction_version: string }
  >()

  freshIndexes.forEach((chunk_index, i) => {
    embeddingByChunkIndex.set(chunk_index, {
      vector: freshEmbeddings[i],
      embedding_model: EMBEDDING_MODEL,
      embedding_version: EMBEDDING_VERSION,
    })
    metadataByChunkIndex.set(chunk_index, {
      ...freshMetadata[i],
      extraction_model: EXTRACTION_MODEL,
      extraction_version: EXTRACTION_VERSION,
    })
  })

  for (const [chunk_index, r] of reused) {
    embeddingByChunkIndex.set(chunk_index, {
      vector: r.vector,
      embedding_model: r.embeddingModel,
      embedding_version: r.embeddingVersion,
    })
    metadataByChunkIndex.set(chunk_index, {
      ...r.metadata,
      extraction_model: r.extractionModel,
      extraction_version: r.extractionVersion,
    })
  }

  const embeddingRows = insertedChunks.map(({ id, chunk_index }: { id: string; chunk_index: number }) => {
    const e = embeddingByChunkIndex.get(chunk_index)!
    return {
      chunk_id: id,
      vector: e.vector,
      embedding_model: e.embedding_model,
      embedding_version: e.embedding_version,
    }
  })

  const { error: insertEmbeddingsError } = await admin.from('embeddings').insert(embeddingRows)
  if (insertEmbeddingsError) {
    throw new Error(`Failed to insert embeddings: ${insertEmbeddingsError.message}`)
  }

  const metadataRows = insertedChunks.map(({ id, chunk_index }: { id: string; chunk_index: number }) => {
    const m = metadataByChunkIndex.get(chunk_index)!
    return {
      chunk_id: id,
      emotion: m.emotion,
      emotion_confidence: m.emotion_confidence,
      secondary_emotion: m.secondary_emotion,
      secondary_emotion_confidence: m.secondary_emotion_confidence,
      intensity: m.intensity,
      topics: m.topics,
      entities: m.entities,
      extraction_model: m.extraction_model,
      extraction_version: m.extraction_version,
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
