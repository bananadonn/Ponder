import { supabase } from './supabase'
import { base64ToBytes, importAesKey } from './crypto'

/**
 * Caches the current user's per-session Data Encryption Key (DEK), fetched
 * once via the derive-key Edge Function (which unwraps it server-side using
 * the master key) and never re-fetched for the same user id. Deliberately a
 * plain module-level cache, not a React context -- mirrors signedUrlCache in
 * src/data/attachments.ts, and lets every framework-agnostic data module
 * (entries.ts, chunks.ts, search.ts, attachments.ts) call it directly.
 */

let cachedUserId: string | null = null
let cachedKey: CryptoKey | null = null
let pending: Promise<CryptoKey> | null = null

export async function getSessionDek(): Promise<CryptoKey> {
  // getSession() reads local storage -- no network round trip -- so the
  // cache-hit fast path here stays cheap even though every data-layer
  // function calls this. derive-key itself authenticates the caller
  // server-side via its own getUser() call.
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not authenticated')

  if (cachedKey && cachedUserId === userId) return cachedKey
  if (pending) return pending

  pending = (async () => {
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('derive-key')
      if (fnError) throw fnError
      const key = await importAesKey(base64ToBytes(fnData.dek), false)
      cachedKey = key
      cachedUserId = userId
      return key
    } finally {
      pending = null
    }
  })()
  return pending
}

export function clearSessionDek(): void {
  cachedKey = null
  cachedUserId = null
  pending = null
}
