// One-off backfill: encrypts existing plaintext entries.content/content_doc
// and attachments.filename/transcript in place, using the same envelope
// encryption scheme process-entry/derive-key use going forward (see
// scripts/crypto.mjs and PLAN.md). Idempotent -- rows already tagged "v1."
// are skipped, so it's safe to re-run (e.g. after it's interrupted).
//
// Run this BEFORE scripts/reprocess-entries.mjs --all: that script
// regenerates chunks (in encrypted form, since process-entry now encrypts
// what it writes) from whatever's currently in entries.content, so it needs
// this script's output, not the other way around.
//
// Usage:
//   node --env-file=scripts/.env scripts/backfill-encrypt-entries.mjs

import { createClient } from '@supabase/supabase-js'
import { base64ToBytes, encrypt, getUserDek, importAesKey } from './crypto.mjs'

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

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('v1.')
}

const BATCH_SIZE = 100

async function backfillEntries() {
  let processed = 0
  let encrypted = 0
  let offset = 0

  for (;;) {
    const { data: rows, error } = await supabase
      .from('entries')
      .select('id, user_id, content, content_doc')
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)
    if (error) {
      console.error('Failed to list entries:', error.message)
      process.exit(1)
    }
    if (!rows || rows.length === 0) break

    for (const row of rows) {
      processed++
      if (isEncrypted(row.content) && (row.content_doc === null || isEncrypted(row.content_doc))) continue

      const dek = await dekFor(row.user_id)
      const content = isEncrypted(row.content) ? row.content : await encrypt(dek, row.content)
      const content_doc = isEncrypted(row.content_doc)
        ? row.content_doc
        : row.content_doc === null
          ? null
          : await encrypt(dek, row.content_doc)

      const { error: updateError } = await supabase.from('entries').update({ content, content_doc }).eq('id', row.id)
      if (updateError) {
        console.error(`  entry ${row.id}: FAILED — ${updateError.message}`)
        continue
      }
      encrypted++
    }

    offset += BATCH_SIZE
  }

  console.log(`entries: ${processed} checked, ${encrypted} encrypted (rest already tagged).`)
}

async function backfillAttachmentText() {
  let processed = 0
  let encrypted = 0
  let offset = 0

  for (;;) {
    const { data: rows, error } = await supabase
      .from('attachments')
      .select('id, user_id, filename, transcript')
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)
    if (error) {
      console.error('Failed to list attachments:', error.message)
      process.exit(1)
    }
    if (!rows || rows.length === 0) break

    for (const row of rows) {
      processed++
      if (isEncrypted(row.filename) && (row.transcript === null || isEncrypted(row.transcript))) continue

      const dek = await dekFor(row.user_id)
      const filename = isEncrypted(row.filename) ? row.filename : await encrypt(dek, row.filename)
      const transcript = isEncrypted(row.transcript)
        ? row.transcript
        : row.transcript === null
          ? null
          : await encrypt(dek, row.transcript)

      const { error: updateError } = await supabase
        .from('attachments')
        .update({ filename, transcript })
        .eq('id', row.id)
      if (updateError) {
        console.error(`  attachment ${row.id}: FAILED — ${updateError.message}`)
        continue
      }
      encrypted++
    }

    offset += BATCH_SIZE
  }

  console.log(`attachments (filename/transcript): ${processed} checked, ${encrypted} encrypted (rest already tagged).`)
}

await backfillEntries()
await backfillAttachmentText()

console.log('\nDone. Next: node --env-file=scripts/.env scripts/backfill-encrypt-attachments.mjs (Storage file bytes), then scripts/reprocess-entries.mjs --all (regenerate chunks).')
