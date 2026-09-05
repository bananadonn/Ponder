import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Same cap for every account (see the "same fixed cap" decision) -- override
// via the DAILY_USAGE_CAP_USD secret if the ballpark ever needs adjusting
// without a code change.
export const DAILY_USAGE_CAP_USD = Number(Deno.env.get('DAILY_USAGE_CAP_USD') ?? '0.25')

export class DailyUsageCapError extends Error {
  constructor() {
    super('Daily usage limit reached for this account. It resets at midnight UTC.')
    this.name = 'DailyUsageCapError'
  }
}

// Must run BEFORE the paid OpenAI call in every function that spends money.
// Pass the caller's own authenticated client where one exists (RLS then
// scopes the sum to their own api_usage rows); process-entry and
// transcribe-audio run off DB webhooks with no user session, so they pass
// the service-role admin client instead, which bypasses RLS and can sum any
// user_id directly.
export async function assertUnderDailyCap(client: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await client.rpc('get_daily_usage_usd', { p_user_id: userId })
  if (error) throw error
  if ((data ?? 0) >= DAILY_USAGE_CAP_USD) throw new DailyUsageCapError()
}

// Best-effort -- a logging failure must never fail a request whose OpenAI
// call already succeeded (and already cost money). Call from a `finally` so
// partial spend from a request that errors partway through is still
// recorded, not just spend from a fully successful request.
export async function recordUsage(
  client: SupabaseClient,
  userId: string,
  functionName: string,
  costUsd: number,
): Promise<void> {
  if (costUsd <= 0) return
  try {
    const { error } = await client.from('api_usage').insert({ user_id: userId, function_name: functionName, cost_usd: costUsd })
    if (error) throw error
  } catch (err) {
    console.error('api_usage insert failed', err)
  }
}

// Shared response shape for the hard-block path -- every function returns
// this same 429 body so the frontend can show one consistent message
// regardless of which feature tripped the cap.
export function dailyCapResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'Daily usage limit reached for this account. It resets at midnight UTC.' }), {
    status: 429,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
