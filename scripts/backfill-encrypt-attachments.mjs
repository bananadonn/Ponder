// One-off backfill: encrypts existing plaintext attachment file bytes
// (images + audio) in Storage, in place, using the same per-user DEK as
// scripts/backfill-encrypt-entries.mjs (run that one first -- it encrypts
// attachments.filename/transcript, which this script doesn't touch).
//
// Idempotent via trial-decryption rather than a marker column -- see
// isAlreadyEncrypted below: GCM authentication fails loudly on anything
// that isn't validly-tagged ciphertext under this user's DEK, so it
// reliably tells an already-encrypted object apart from a plaintext one.
//
// Usage:
//   node --env-file=scripts/.env scripts/backfill-encrypt-attachments.mjs

import { createClient } from '@supabase/supabase-js'
import { base64ToBytes, decryptBytes, encryptBytes, getUserDek, importAesKey } from './crypto.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPTION_MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ENCRYPTION_MASTER_KEY) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ENCRYPTION_MASTER_KEY. See scripts/.env.example.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const masterKey = await importAesKey(base64ToBytes(ENCRYPTION_MASTER_KEY), false)

const dekCache = new Map()
async function dekFor(userId) {
  if (!dekCache.has(userId)) {
    dekCache.set(userId, await getUserDek(supabase, masterKey, userId))
  }
  return dekCache.get(userId)
}

const IMAGE_BUCKET = 'entry-images'
const AUDIO_BUCKET = 'entry-audio'

// A byte-level "is this already ciphertext" test isn't reliable (encrypted
// bytes are indistinguishable from plaintext bytes without decrypting and
// checking whether the result parses as the declared mime type) -- so this
// script trial-decrypts, and treats a successful GCM auth-tag check as
// "already encrypted, skip". GCM decryption fails loudly (throws) on
// anything that isn't validly-tagged ciphertext under this user's DEK, so a
// plaintext image/audio file (or one encrypted under a different user's
// DEK, which shouldn't happen) reliably throws and is treated as
// not-yet-encrypted.
async function isAlreadyEncrypted(bytes, dek) {
  try {
    await decryptBytes(dek, bytes)
    return true
  } catch {
    return false
  }
}

const BATCH_SIZE = 50

async function backfillBucket(bucket) {
  let processed = 0
  let encrypted = 0
  let offset = 0

  for (;;) {
    const { data: rows, error } = await supabase
      .from('attachments')
      .select('id, user_id, storage_path, mime_type')
      .like('mime_type', bucket === IMAGE_BUCKET ? 'image/%' : 'audio/%')
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)
    if (error) {
      console.error(`Failed to list ${bucket} attachments:`, error.message)
      process.exit(1)
    }
    if (!rows || rows.length === 0) break

    for (const row of rows) {
      processed++
      process.stdout.write(`  ${bucket}/${row.storage_path}... `)

      const dek = await dekFor(row.user_id)
      const { data: file, error: downloadError } = await supabase.storage.from(bucket).download(row.storage_path)
      if (downloadError || !file) {
        console.log(`FAILED to download — ${downloadError?.message}`)
        continue
      }
      const bytes = new Uint8Array(await file.arrayBuffer())

      if (await isAlreadyEncrypted(bytes, dek)) {
        console.log('already encrypted, skipped')
        continue
      }

      const encryptedBytes = await encryptBytes(dek, bytes)
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(row.storage_path, new Blob([encryptedBytes], { type: row.mime_type }), {
          contentType: row.mime_type,
          upsert: true,
        })
      if (uploadError) {
        console.log(`FAILED to re-upload — ${uploadError.message}`)
        continue
      }
      console.log('encrypted')
      encrypted++
    }

    offset += BATCH_SIZE
  }

  console.log(`${bucket}: ${processed} checked, ${encrypted} encrypted.\n`)
}

await backfillBucket(IMAGE_BUCKET)
await backfillBucket(AUDIO_BUCKET)

console.log('Done.')
