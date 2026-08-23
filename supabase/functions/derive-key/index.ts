import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { base64ToBytes, bytesToBase64, getUserDekBytes, importAesKey } from '../_shared/crypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ENCRYPTION_MASTER_KEY = Deno.env.get('ENCRYPTION_MASTER_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// The only place raw key material ever leaves the server, and only to the
// authenticated owner over HTTPS. Every other Edge Function that needs a
// user's DEK calls getUserDek(admin, masterKey, userId) directly
// (server-side only, never exported to a client).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const masterKey = await importAesKey(base64ToBytes(ENCRYPTION_MASTER_KEY), false)
    const dekBytes = await getUserDekBytes(admin, masterKey, userData.user.id)

    return new Response(JSON.stringify({ dek: bytesToBase64(dekBytes) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
