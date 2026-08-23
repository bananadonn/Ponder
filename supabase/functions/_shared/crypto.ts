// Envelope-encryption primitives (AES-256-GCM via WebCrypto).
//
// Keep the primitives section of this file byte-for-byte identical across:
//   src/lib/crypto.ts, supabase/functions/_shared/crypto.ts, scripts/crypto.mjs
// Three runtimes (browser, Deno, Node), no shared build step between them --
// see supabase/functions/_shared/richDocPlainText.ts for the same
// hand-sync convention already used in this codebase. The getUserDek*
// section below is server-only (appears here and in scripts/crypto.mjs,
// not in src/lib/crypto.ts -- the browser never touches user_keys).
//
// btoa/atob/crypto.subtle/crypto.getRandomValues are global and behave
// identically in browsers, Deno, and Node >=19.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALGO = 'AES-GCM'
const IV_BYTES = 12
const VERSION_TAG = 'v1'

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function generateRawKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

// extractable=false everywhere except the one caller (the derive-key Edge
// Function) that legitimately needs to ship raw key bytes to the browser --
// that caller uses getUserDekBytes directly and never imports a CryptoKey.
export async function importAesKey(rawKey: Uint8Array, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey as BufferSource, ALGO, extractable, ['encrypt', 'decrypt'])
}

// "v1." + base64(iv) + "." + base64(ciphertext+tag). Base64's alphabet
// never contains ".", so splitting on "." is safe.
export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded)
  return `${VERSION_TAG}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`
}

export async function decrypt(key: CryptoKey, blob: string): Promise<string> {
  const parts = blob.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION_TAG) {
    throw new Error('Not a well-formed v1 encrypted blob')
  }
  const iv = base64ToBytes(parts[1])
  const ciphertext = base64ToBytes(parts[2])
  const plaintext = await crypto.subtle.decrypt({ name: ALGO, iv: iv as BufferSource }, key, ciphertext as BufferSource)
  return new TextDecoder().decode(plaintext)
}

// Legacy-plaintext-safe read path: anything not tagged "v1." passes through
// unchanged (pre-encryption rows, or a jsonb->text cast that hasn't been
// through the backfill yet). Makes rollout order non-critical and backfill
// scripts idempotent (skip rows already tagged).
export async function decryptOrPassthrough(key: CryptoKey, value: string | null): Promise<string | null> {
  if (value === null) return null
  if (!value.startsWith(`${VERSION_TAG}.`)) return value
  return decrypt(key, value)
}

// Raw binary format for Storage objects (images/audio): iv (12 bytes) ||
// ciphertext+tag, no base64/version-tag framing -- avoids ~33% bloat on
// multi-MB files. Storage objects are always freshly written by this app,
// so there's no "legacy plaintext" passthrough case to handle here the way
// there is for encrypt()/decrypt() above.
export async function encryptBytes(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: ALGO, iv }, key, plaintext as BufferSource))
  const out = new Uint8Array(iv.length + ciphertext.length)
  out.set(iv, 0)
  out.set(ciphertext, iv.length)
  return out
}

export async function decryptBytes(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  const iv = blob.slice(0, IV_BYTES)
  const ciphertext = blob.slice(IV_BYTES)
  const plaintext = await crypto.subtle.decrypt({ name: ALGO, iv: iv as BufferSource }, key, ciphertext as BufferSource)
  return new Uint8Array(plaintext)
}

// --- Server-only: per-user DEK lookup/creation. Not present in
// src/lib/crypto.ts -- the browser never reads/writes user_keys directly,
// only ever receives its own unwrapped DEK from the derive-key function. ---

// Race-safe create-or-fetch: two concurrent first-time callers for the same
// brand-new user (e.g. the client's derive-key call racing the entries
// insert webhook's process-entry call) must never both write a DEK for that
// user -- INSERT...ON CONFLICT DO NOTHING + re-select means the loser
// always ends up using the winner's row rather than orphaning data it
// already encrypted under its own locally-generated (but discarded) DEK.
export async function getUserDekBytes(
  admin: SupabaseClient,
  masterKey: CryptoKey,
  userId: string,
): Promise<Uint8Array> {
  const { data: existing, error: selectError } = await admin
    .from('user_keys')
    .select('wrapped_dek')
    .eq('user_id', userId)
    .maybeSingle()
  if (selectError) throw selectError
  if (existing) return base64ToBytes(await decrypt(masterKey, existing.wrapped_dek))

  const rawDek = generateRawKey()
  const wrapped = await encrypt(masterKey, bytesToBase64(rawDek))

  const { error: insertError } = await admin.from('user_keys').insert({ user_id: userId, wrapped_dek: wrapped })

  if (insertError) {
    if (insertError.code === '23505') {
      // Lost the race -- another caller already created this user's row.
      // Use theirs. Never overwrite (would orphan data already encrypted
      // under the winner's DEK).
      const { data: row, error: reselectError } = await admin
        .from('user_keys')
        .select('wrapped_dek')
        .eq('user_id', userId)
        .single()
      if (reselectError || !row) throw reselectError ?? new Error('user_keys row missing after conflict')
      return base64ToBytes(await decrypt(masterKey, row.wrapped_dek))
    }
    throw insertError
  }

  return rawDek
}

export async function getUserDek(admin: SupabaseClient, masterKey: CryptoKey, userId: string): Promise<CryptoKey> {
  return importAesKey(await getUserDekBytes(admin, masterKey, userId), false)
}
