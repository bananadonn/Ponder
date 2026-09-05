import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { embedTexts } from '../_shared/openai.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { assertUnderDailyCap, dailyCapResponse, DailyUsageCapError, recordUsage } from '../_shared/usage.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

// Starting point, not a tuned value — tune this against your own data via
// the debug search page rather than trusting this number.
const DEFAULT_SIMILARITY_THRESHOLD = 0.3
const DEFAULT_MATCH_COUNT = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let body: { query?: string; threshold?: number; limit?: number }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const query = body.query?.trim()
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const threshold = body.threshold ?? DEFAULT_SIMILARITY_THRESHOLD
  const limit = body.limit ?? DEFAULT_MATCH_COUNT

  // Runs as the calling user (not service role) — RLS on chunks/embeddings
  // scopes match_chunks' results to their own entries automatically.
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

    const embedded = await embedTexts([query], OPENAI_API_KEY)
    costUsd += embedded.costUsd
    const [queryEmbedding] = embedded.vectors

    const { data, error } = await userClient.rpc('match_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    })

    if (error) throw error

    return new Response(JSON.stringify({ results: data, threshold, limit }), {
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
    await recordUsage(userClient, userId, 'search-chunks', costUsd)
  }
})
