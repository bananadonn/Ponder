import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { transcribeAudio } from '../_shared/openai.ts'
import { joinContent, richDocPlainText, setAudioTranscript, splitContentTitle } from '../_shared/richDocPlainText.ts'
import { base64ToBytes, decryptBytes, decryptOrPassthrough, encrypt, getUserDek, importAesKey } from '../_shared/crypto.ts'
import { assertUnderDailyCap, DailyUsageCapError, recordUsage } from '../_shared/usage.ts'

const AUDIO_BUCKET = 'entry-audio'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const ENCRYPTION_MASTER_KEY = Deno.env.get('ENCRYPTION_MASTER_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const masterKeyPromise = importAesKey(base64ToBytes(ENCRYPTION_MASTER_KEY), false)

interface AttachmentRecord {
  id: string
  entry_id: string
  user_id: string
  storage_path: string
  filename: string
  mime_type: string
}

// Patches the owning entry's content_doc/content with the finished
// transcript. This write hits the same columns the entries webhook watches
// for process-entry, so saving here is what re-triggers chunking/embedding
// for the new paragraph -- no direct call to process-entry needed, and
// loadReusableChunks in process-entry ensures every other unchanged
// paragraph in the entry is reused rather than re-billed.
async function writeTranscriptToEntry(
  entryId: string,
  attachmentId: string,
  transcript: string,
  dek: CryptoKey,
): Promise<void> {
  const { data: entry, error } = await admin
    .from('entries')
    .select('id, content, content_doc')
    .eq('id', entryId)
    .single()
  if (error || !entry) {
    throw new Error(`Entry not found for transcript write-back: ${entryId}`)
  }
  const decryptedDocText = await decryptOrPassthrough(dek, entry.content_doc)
  if (!decryptedDocText) {
    // No rich doc to patch (legacy plain-text entry) -- nothing to do. This
    // shouldn't happen in practice since only the rich editor can insert an
    // audio node in the first place.
    return
  }
  const contentDoc = JSON.parse(decryptedDocText)

  const patchedDoc = setAudioTranscript(contentDoc, attachmentId, transcript)
  if (!patchedDoc) {
    // The audio node is no longer present in content_doc -- e.g. the user
    // deleted it from the entry before transcription finished. Nothing to
    // write back.
    return
  }

  const plainContent = (await decryptOrPassthrough(dek, entry.content))!
  const title = splitContentTitle(plainContent)
  const newContent = joinContent(title, richDocPlainText(patchedDoc))

  const { error: updateError } = await admin
    .from('entries')
    .update({
      content: await encrypt(dek, newContent),
      content_doc: await encrypt(dek, JSON.stringify(patchedDoc)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
  if (updateError) {
    throw new Error(`Failed to write transcript back to entry: ${updateError.message}`)
  }
}

async function processAttachment(record: AttachmentRecord): Promise<{ skipped?: string; transcript?: string }> {
  if (!record.mime_type.startsWith('audio/')) {
    return { skipped: 'not an audio attachment' }
  }

  await admin.from('attachments').update({ transcription_status: 'processing' }).eq('id', record.id)

  let costUsd = 0
  try {
    await assertUnderDailyCap(admin, record.user_id)

    const masterKey = await masterKeyPromise
    const dek = await getUserDek(admin, masterKey, record.user_id)

    const { data: encryptedAudioFile, error: downloadError } = await admin.storage
      .from(AUDIO_BUCKET)
      .download(record.storage_path)
    if (downloadError || !encryptedAudioFile) {
      throw new Error(`Failed to download audio: ${downloadError?.message}`)
    }
    const encryptedBytes = new Uint8Array(await encryptedAudioFile.arrayBuffer())
    const plainBytes = await decryptBytes(dek, encryptedBytes)
    const audioFile = new Blob([plainBytes], { type: record.mime_type })

    // filename's extension is what tells Whisper the audio format -- it must
    // be decrypted before use, not the ciphertext blob stored in the row.
    const filename = (await decryptOrPassthrough(dek, record.filename))!

    const transcribed = await transcribeAudio(audioFile, filename, OPENAI_API_KEY)
    costUsd = transcribed.costUsd
    const transcript = transcribed.text

    const { error: updateError } = await admin
      .from('attachments')
      .update({ transcript: await encrypt(dek, transcript), transcription_status: 'complete' })
      .eq('id', record.id)
    if (updateError) {
      throw new Error(`Failed to save transcript: ${updateError.message}`)
    }

    await writeTranscriptToEntry(record.entry_id, record.id, transcript, dek)

    return { transcript }
  } finally {
    await recordUsage(admin, record.user_id, 'transcribe-audio', costUsd)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // This function is only ever invoked by the attachments-table INSERT
  // webhook (service role auth) -- never from the browser, unlike
  // process-entry, so there's no per-caller ownership check to fall back
  // to. A non-service-role caller is simply rejected.
  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (callerToken !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { record?: AttachmentRecord }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const record = body.record
  if (!record?.id || !record.entry_id || !record.user_id || !record.storage_path || !record.mime_type) {
    return new Response(JSON.stringify({ error: 'Missing required attachment fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await processAttachment(record)
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    await admin.from('attachments').update({ transcription_status: 'failed' }).eq('id', record.id)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: err instanceof DailyUsageCapError ? 429 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
