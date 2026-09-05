import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { chatCompletion } from '../_shared/openai.ts'
import { assertUnderDailyCap, dailyCapResponse, DailyUsageCapError, recordUsage } from '../_shared/usage.ts'

const SYNTHESIS_MODEL = 'gpt-4o-mini'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

const SYNTHESIS_SYSTEM_PROMPT = `You answer questions about the user's personal journal using only the excerpts provided. This is a personal journaling app, not a clinical or therapeutic tool.

Rules:
- Stay strictly descriptive: report what was written and when. Example: "You wrote about the AC repair being frustrating on three separate days: Aug 7, Aug 8, and Aug 9."
- Never diagnose, interpret, or psychoanalyze. Do not say things like "it seems like you're struggling with X" or "this suggests you may be dealing with Y." Report what was written, not what it might mean.
- Do not offer advice, encouragement, reassurance, or emotional commentary of any kind. Just report what's in the journal.
- Every claim must be traceable to specific excerpts — cite their dates in the answer text. Do not generalize beyond what the excerpts actually say.
- Set grounded to false if the excerpts don't actually address the question, rather than stretching them into an answer. A plain "your journal doesn't have entries about X" is correct behavior, not a failure — do this whenever the excerpts are a weak or tangential match to the question.
- List the chunk_id of every excerpt the answer actually draws from in cited_chunk_ids. If grounded is false, this must be empty.`

interface ChunkInput {
  chunk_id: string
  entry_id: string
  text: string
  entry_created_at: string
  similarity: number | null
  source: 'vector' | 'structured' | 'both'
}

interface RequestBody {
  question?: string
  matched?: boolean
  results?: ChunkInput[]
}

interface SynthesisResult {
  grounded: boolean
  answer: string
  cited_chunk_ids: string[]
}

function formatExcerpts(chunks: ChunkInput[]): string {
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

async function synthesize(question: string, results: ChunkInput[]): Promise<{ result: SynthesisResult; costUsd: number }> {
  const { json, costUsd } = await chatCompletion(
    {
      model: SYNTHESIS_MODEL,
      messages: [
        { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
        { role: 'user', content: `Question: ${question}\n\nJournal excerpts:\n\n${formatExcerpts(results)}` },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'synthesis',
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
                description: 'The descriptive answer if grounded, or a plain statement that the journal lacks relevant entries if not.',
              },
              cited_chunk_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'chunk_id values the answer draws from. Empty if grounded is false.',
              },
            },
            required: ['grounded', 'answer', 'cited_chunk_ids'],
            additionalProperties: false,
          },
        },
      },
    },
    OPENAI_API_KEY,
    'synthesis',
  )

  const parsed: SynthesisResult = JSON.parse(json.choices[0].message.content)

  // Integrity check: only trust citations that actually point at excerpts we
  // sent. If nothing survives, this isn't really grounded — a "grounded"
  // answer with no traceable citation is exactly the untethered-summary
  // problem this phase is meant to avoid.
  const validIds = new Set(results.map((r) => r.chunk_id))
  const citedIds = parsed.cited_chunk_ids.filter((id) => validIds.has(id))

  if (parsed.grounded && citedIds.length === 0) {
    return {
      result: {
        grounded: false,
        answer: "The model didn't ground its answer in any of the provided excerpts, so it's being treated as unanswered rather than trusted as-is.",
        cited_chunk_ids: [],
      },
      costUsd,
    }
  }

  return { result: { grounded: parsed.grounded, answer: parsed.answer, cited_chunk_ids: citedIds }, costUsd }
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

  const question = body.question?.trim()
  if (!question) {
    return new Response(JSON.stringify({ error: 'Missing question' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Phase 4 already found nothing — don't spend an LLM call trying to force
  // an answer out of weak or nonexistent chunks. This is the deterministic,
  // 100%-reliable half of "say so plainly"; the LLM-judged half (chunks
  // exist but don't really address the question) is the grounded:false path.
  if (!body.matched || !body.results || body.results.length === 0) {
    return new Response(
      JSON.stringify({
        grounded: false,
        answer: "Your journal doesn't have any entries that match this question.",
        cited_chunk_ids: [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

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

    const synthesized = await synthesize(question, body.results)
    costUsd = synthesized.costUsd
    return new Response(JSON.stringify(synthesized.result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof DailyUsageCapError) return dailyCapResponse(corsHeaders)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } finally {
    await recordUsage(userClient, userId, 'synthesize-answer', costUsd)
  }
})
