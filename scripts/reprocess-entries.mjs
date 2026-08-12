// One-off backfill: (re)runs the chunking + embedding pipeline for entries
// that predate it, or that are stuck in a non-complete state.
//
// Usage:
//   node --env-file=scripts/.env scripts/reprocess-entries.mjs          # only non-complete entries
//   node --env-file=scripts/.env scripts/reprocess-entries.mjs --all    # every entry

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See scripts/.env.example.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const reprocessAll = process.argv.includes('--all')

let query = supabase.from('entries').select('id, processing_status').order('created_at', { ascending: true })
if (!reprocessAll) {
  query = query.neq('processing_status', 'complete')
}

const { data: entries, error } = await query
if (error) {
  console.error('Failed to list entries:', error.message)
  process.exit(1)
}

console.log(`Reprocessing ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}...`)

let succeeded = 0
let failed = 0

for (const entry of entries) {
  process.stdout.write(`  ${entry.id} (was: ${entry.processing_status})... `)
  const { data, error: invokeError } = await supabase.functions.invoke('process-entry', {
    body: { record: { id: entry.id } },
  })

  if (invokeError) {
    console.log(`FAILED — ${invokeError.message}`)
    failed++
  } else {
    console.log(`ok (${data.chunkCount} chunks)`)
    succeeded++
  }
}

console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`)
