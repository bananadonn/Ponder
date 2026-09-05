import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { chatCompletion, embedTexts } from '../_shared/openai.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { buildQueryEmbeddingInput } from '../_shared/queryEmbeddingInput.ts'
import { base64ToBytes, decryptOrPassthrough, getUserDek, importAesKey } from '../_shared/crypto.ts'
import { assertUnderDailyCap, dailyCapResponse, DailyUsageCapError, recordUsage } from '../_shared/usage.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const ENCRYPTION_MASTER_KEY = Deno.env.get('ENCRYPTION_MASTER_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const masterKeyPromise = importAesKey(base64ToBytes(ENCRYPTION_MASTER_KEY), false)

const REWRITE_MODEL = 'gpt-4o-mini'
const REFLECTION_MODEL = 'gpt-4o-mini'
const SIMILARITY_THRESHOLD = 0.3
const VECTOR_LIMIT = 20
const HISTORY_TURNS_FOR_GENERATION = 6

// First person by design (the user asked for "a conversational clone"), but
// that only changes grammatical framing — it must not loosen the same
// non-diagnostic, grounded-only rules synthesize-answer already enforces
// (PRODUCT.md: "reflects back what was written, never interprets it
// clinically or therapeutically").
const REFLECTION_SYSTEM_PROMPT = `You speak AS the user, in first person, reflecting on their own real journal entries — their inner reflective voice recalling their own past, not a third party describing them. This is a personal journaling app, not a clinical or therapeutic tool.

Rules:
- Only draw on the journal excerpts provided. Never invent memories, dates, or details that aren't in the excerpts.
- Stay strictly descriptive: recall what was written and when, in first person. Example: "I remember being frustrated about the AC repair — that came up on Aug 7, 8, and 9."
- Never diagnose, interpret, or psychoanalyze yourself. Do not say things like "it seems like I was struggling with X" or "this suggests I was dealing with Y." Recall what was written, not what it might mean.
- Do not offer yourself advice, reassurance, or emotional commentary beyond what the excerpts themselves say.
- This is the most important formatting rule and it is not optional: every factual claim in "answer" must end with a literal bracketed citation marker typed directly into the string, e.g. "...that came up on Aug 7 [1] and again on Aug 9 [2]." Reuse the same number for the same excerpt if you cite it more than once. An answer with zero bracket markers in it is malformed — never produce one when grounded is true.
- The "citations" array must list every marker number you actually typed into the answer text, each mapped to the chunk_id it came from — the two must match exactly. If grounded is false, this must be empty and the answer must contain no markers.`

interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

interface Filters {
  emotions?: string[]
  entities?: string[]
  topics?: string[]
  startDate?: string
  endDate?: string
}

interface RequestBody {
  message?: string
  history?: HistoryTurn[]
  filters?: Filters
}

interface RetrievedChunk {
  chunk_id: string
  entry_id: string
  text: string
  entry_created_at: string
}

interface ReflectCitation {
  index: number
  chunk_id: string
  entry_id: string
  entry_created_at: string
}

interface ReflectResponse {
  answer: string
  grounded: boolean
  citations: ReflectCitation[]
}

function hasActiveFilters(filters?: Filters): boolean {
  if (!filters) return false
  return Boolean(
    (filters.emotions && filters.emotions.length > 0) ||
      (filters.entities && filters.entities.length > 0) ||
      (filters.topics && filters.topics.length > 0) ||
      filters.startDate ||
      filters.endDate,
  )
}

// Retrieval-only — the rewritten text is never surfaced to the user or fed
// into generation, same "fabricated, drive search only" contract HyDE's
// generateHypotheticalEntry already follows in _shared/hyde.ts.
async function rewriteQuery(
  message: string,
  history: HistoryTurn[],
  apiKey: string,
): Promise<{ text: string; costUsd: number }> {
  const transcript = history
    .slice(-HISTORY_TURNS_FOR_GENERATION)
    .map((t) => `${t.role === 'user' ? 'Q' : 'A'}: ${t.content}`)
    .join('\n')

  const { json, costUsd } = await chatCompletion(
    {
      model: REWRITE_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Rewrite the latest message as a standalone question that makes sense on its own, using the conversation only to resolve pronouns or references (e.g. "him", "that", "what about last week"). If it is already standalone, return it unchanged. Reply with only the rewritten question, nothing else.',
        },
        { role: 'user', content: `Conversation so far:\n${transcript}\n\nLatest message: ${message}` },
      ],
    },
    apiKey,
    'rewrite',
  )

  const text: string | undefined = json.choices?.[0]?.message?.content?.trim()
  return { text: text || message, costUsd }
}

function formatExcerpts(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => {
      const date = new Date(c.entry_created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
      return `[chunk_id: ${c.chunk_id} | ${date}]\n${c.text}`
    })
    .join('\n\n')
}

// Safety net for prompt non-compliance: gpt-4o-mini doesn't reliably place
// the instructed [n] markers in the answer text even when it returns a
// well-formed citations array, which would otherwise leave a "grounded"
// answer with nothing clickable. Any citation whose marker didn't make it
// into the text gets appended at the end, so a citation is never silently
// lost — the model's own inline placement (when it does comply) is always
// preferred since this only adds what's missing.
function ensureCitationMarkers(answer: string, citations: { index: number }[]): string {
  const missing = citations.filter((c) => !answer.includes(`[${c.index}]`))
  if (missing.length === 0) return answer
  return `${answer} ${missing.map((c) => `[${c.index}]`).join(' ')}`
}

interface GenerationResult {
  grounded: boolean
  answer: string
  citations: { index: number; chunk_id: string }[]
}

async function generateReflection(
  question: string,
  history: HistoryTurn[],
  chunks: RetrievedChunk[],
  apiKey: string,
): Promise<{ result: GenerationResult; costUsd: number }> {
  const transcript = history
    .slice(-HISTORY_TURNS_FOR_GENERATION)
    .map((t) => `${t.role === 'user' ? 'Q' : 'A'}: ${t.content}`)
    .join('\n')

  const userContent = [
    transcript && `Conversation so far:\n${transcript}`,
    `Journal excerpts:\n\n${formatExcerpts(chunks)}`,
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const { json, costUsd } = await chatCompletion(
    {
      model: REFLECTION_MODEL,
      messages: [
        { role: 'system', content: REFLECTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'reflection',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              grounded: {
                type: 'boolean',
                description: 'True if the excerpts actually let you answer the question; false if they do not really address it.',
              },
              answer: {
                type: 'string',
                description:
                  'First-person answer with inline [n] citation markers, or a plain first-person statement that nothing relevant was found if not grounded.',
              },
              citations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', description: 'The marker number as used in the answer, e.g. 1 for [1].' },
                    chunk_id: { type: 'string' },
                  },
                  required: ['index', 'chunk_id'],
                  additionalProperties: false,
                },
                description: 'Every marker number used in the answer, mapped to its source chunk_id. Empty if grounded is false.',
              },
            },
            required: ['grounded', 'answer', 'citations'],
            additionalProperties: false,
          },
        },
      },
    },
    apiKey,
    'reflection',
  )

  return { result: JSON.parse(json.choices[0].message.content), costUsd }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const message = body.message?.trim()
  if (!message) {
    return new Response(JSON.stringify({ error: 'Missing message' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const history = body.history ?? []

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const userId = userData.user.id

  let costUsd = 0
  try {
    await assertUnderDailyCap(userClient, userId)

    let rewritten = message
    if (history.length > 0) {
      const rewrite = await rewriteQuery(message, history, OPENAI_API_KEY)
      rewritten = rewrite.text
      costUsd += rewrite.costUsd
    }

    const embeddingInput = await buildQueryEmbeddingInput(rewritten, 'hyde', OPENAI_API_KEY)
    costUsd += embeddingInput.costUsd
    const embedded = await embedTexts([embeddingInput.text], OPENAI_API_KEY)
    costUsd += embedded.costUsd
    const [queryEmbedding] = embedded.vectors

    const { data: vectorRows, error: vectorError } = await userClient.rpc('match_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: SIMILARITY_THRESHOLD,
      match_count: VECTOR_LIMIT,
    })
    if (vectorError) throw vectorError

    let chunks: RetrievedChunk[] = vectorRows ?? []

    if (hasActiveFilters(body.filters)) {
      const { data: allowedRows, error: filterError } = await userClient.rpc('filter_chunks', {
        filter_emotions: body.filters!.emotions?.length ? body.filters!.emotions : null,
        filter_entities: body.filters!.entities?.length ? body.filters!.entities : null,
        filter_topics: body.filters!.topics?.length ? body.filters!.topics : null,
        filter_start: body.filters!.startDate ?? null,
        filter_end: body.filters!.endDate ?? null,
      })
      if (filterError) throw filterError
      const allowedIds = new Set((allowedRows ?? []).map((r: { chunk_id: string }) => r.chunk_id))
      chunks = chunks.filter((c) => allowedIds.has(c.chunk_id))
    }

    if (chunks.length > 0) {
      // Unlike hybrid-search/search-chunks (pure pass-through -- the client
      // decrypts chunk text itself), this function builds the LLM prompt
      // from chunk text directly, so it needs plaintext here.
      const masterKey = await masterKeyPromise
      const dek = await getUserDek(admin, masterKey, userId)
      chunks = await Promise.all(
        chunks.map(async (c) => ({ ...c, text: (await decryptOrPassthrough(dek, c.text))! })),
      )
    }

    if (chunks.length === 0) {
      const empty: ReflectResponse = {
        answer: "I don't have anything in my journal that matches this.",
        grounded: false,
        citations: [],
      }
      return new Response(JSON.stringify(empty), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { result: generated, costUsd: generationCost } = await generateReflection(message, history, chunks, OPENAI_API_KEY)
    costUsd += generationCost

    // Same integrity check as synthesize-answer: only trust citations that
    // actually point at excerpts we sent.
    const chunkById = new Map(chunks.map((c) => [c.chunk_id, c]))
    const validCitations: ReflectCitation[] = generated.citations
      .filter((c) => chunkById.has(c.chunk_id))
      .map((c) => {
        const chunk = chunkById.get(c.chunk_id)!
        return { index: c.index, chunk_id: c.chunk_id, entry_id: chunk.entry_id, entry_created_at: chunk.entry_created_at }
      })

    if (generated.grounded && validCitations.length === 0) {
      const ungrounded: ReflectResponse = {
        answer: "I couldn't ground that in anything specific from my journal, so I don't want to guess.",
        grounded: false,
        citations: [],
      }
      return new Response(JSON.stringify(ungrounded), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const answer = ensureCitationMarkers(generated.answer, validCitations)
    const result: ReflectResponse = { answer, grounded: generated.grounded, citations: validCitations }
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    if (err instanceof DailyUsageCapError) return dailyCapResponse(corsHeaders)
    const messageText = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: messageText }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } finally {
    await recordUsage(userClient, userId, 'reflect', costUsd)
  }
})
