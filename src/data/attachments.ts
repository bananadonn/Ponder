import { supabase } from '../lib/supabase'
import { decryptBytes, decryptOrPassthrough, encrypt, encryptBytes } from '../lib/crypto'
import { getSessionDek } from '../lib/sessionKey'
import type { Attachment } from './types'

/**
 * Framework-agnostic data-access functions for entry image/audio attachments.
 * Mirrors the style of ./entries.ts.
 */

export const IMAGE_BUCKET = 'entry-images'
export const AUDIO_BUCKET = 'entry-audio'

// Signed URLs are requested for a full hour but cached for less, so a page
// that stays open a long time still refreshes before the URL expires.
const SIGNED_URL_TTL_SECONDS = 3600
const SIGNED_URL_CACHE_MARGIN_SECONDS = 600

// Keyed by "bucket:storagePath" -- the two buckets never share a path, but
// namespacing the cache key avoids relying on that to stay true.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

// Decrypted object URLs (blob:), keyed the same way. Session-lived, no
// expiry/revoke -- bounded by how many distinct attachments are actually
// viewed in one session, which is fine at personal-journal scale.
const decryptedUrlCache = new Map<string, string>()

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function decryptAttachment(row: Attachment): Promise<Attachment> {
  const dek = await getSessionDek()
  const filename = (await decryptOrPassthrough(dek, row.filename))!
  return { ...row, filename }
}

async function uploadToBucket(
  bucket: string,
  entryId: string,
  file: File,
  extraColumns: Record<string, unknown>,
): Promise<Attachment> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Not authenticated')

  const storagePath = `${userData.user.id}/${entryId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`

  const dek = await getSessionDek()
  const plainBytes = new Uint8Array(await file.arrayBuffer())
  const encryptedBytes = await encryptBytes(dek, plainBytes)
  // Declared contentType stays the real one (satisfies the bucket's
  // allowed_mime_types check) even though the stored bytes are now
  // ciphertext -- a bare signed-URL open in a browser then just fails to
  // render, which is a feature, not a bug.
  const encryptedBlob = new Blob([encryptedBytes as BlobPart], { type: file.type })

  const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, encryptedBlob, {
    contentType: file.type,
  })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      entry_id: entryId,
      user_id: userData.user.id,
      storage_path: storagePath,
      filename: await encrypt(dek, file.name),
      mime_type: file.type,
      size_bytes: file.size,
      ...extraColumns,
    })
    .select()
    .single()

  if (error) throw error
  return decryptAttachment(data)
}

export async function uploadAttachment(entryId: string, file: File): Promise<Attachment> {
  return uploadToBucket(IMAGE_BUCKET, entryId, file, {})
}

// Voice recordings arrive as a MediaRecorder Blob, not a File -- wrapped
// into one here so the upload path (and the mime_type/filename columns) can
// stay identical to the image flow. durationSeconds comes from wall-clock
// record-start/record-stop timing on the client, not audio metadata
// parsing -- a good enough, zero-cost measurement for a voice note.
export async function uploadAudioAttachment(
  entryId: string,
  blob: Blob,
  durationSeconds: number,
): Promise<Attachment> {
  // MediaRecorder's reported type often carries a codec param
  // (e.g. "audio/webm;codecs=opus") that the bucket's allowed_mime_types
  // list checks don't need and shouldn't have to enumerate every variant of.
  const mimeType = blob.type.split(';')[0] || 'audio/webm'
  const extension = mimeType.split('/')[1] ?? 'webm'
  const file = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: mimeType })

  return uploadToBucket(AUDIO_BUCKET, entryId, file, {
    duration_seconds: durationSeconds,
    transcription_status: 'pending',
  })
}

export async function getSignedUrlCached(storagePath: string, bucket: string = IMAGE_BUCKET): Promise<string> {
  const cacheKey = `${bucket}:${storagePath}`
  const cached = signedUrlCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) throw error

  const expiresAt = Date.now() + (SIGNED_URL_TTL_SECONDS - SIGNED_URL_CACHE_MARGIN_SECONDS) * 1000
  signedUrlCache.set(cacheKey, { url: data.signedUrl, expiresAt })
  return data.signedUrl
}

export async function getAudioSignedUrlCached(storagePath: string): Promise<string> {
  return getSignedUrlCached(storagePath, AUDIO_BUCKET)
}

// Resolves a storage_path to a decrypted, directly-renderable blob: URL --
// the signed URL alone now points at ciphertext, so <img>/<audio src=...>
// can't use it directly. Decrypts once per (bucket, storagePath) per
// session; callers pass the attachment's own mimeType to reconstruct the
// right Blob type.
export async function getDecryptedAttachmentUrl(storagePath: string, bucket: string, mimeType: string): Promise<string> {
  const cacheKey = `${bucket}:${storagePath}`
  const cached = decryptedUrlCache.get(cacheKey)
  if (cached) return cached

  const signedUrl = await getSignedUrlCached(storagePath, bucket)
  const response = await fetch(signedUrl)
  const encryptedBytes = new Uint8Array(await response.arrayBuffer())

  const dek = await getSessionDek()
  const plainBytes = await decryptBytes(dek, encryptedBytes)
  const blob = new Blob([plainBytes as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  decryptedUrlCache.set(cacheKey, url)
  return url
}

export async function listAttachmentsForEntry(entryId: string): Promise<Attachment[]> {
  const { data, error } = await supabase.from('attachments').select('*').eq('entry_id', entryId)
  if (error) throw error
  return Promise.all(data.map(decryptAttachment))
}

// All image attachments across every entry the user has, newest first —
// backs the Rack's gallery view. RLS (see 0016_attachments.sql) already
// scopes this to the current user; the mime_type filter just excludes voice
// notes, which live in the same table.
export async function listImageAttachments(): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .like('mime_type', 'image/%')
    .order('created_at', { ascending: false })
  if (error) throw error
  return Promise.all(data.map(decryptAttachment))
}

// Removes the actual Storage objects for an entry's attachments. Must be
// called before deleting the entry row — the DB cascade on `attachments`
// only removes those rows, never the files sitting in Storage. Image and
// audio rows are split by bucket since Storage.remove() only takes paths
// within a single bucket.
export async function deleteAttachmentsForEntry(entryId: string): Promise<void> {
  const attachments = await listAttachmentsForEntry(entryId)
  if (attachments.length === 0) return

  const images = attachments.filter((a) => !a.mime_type.startsWith('audio/'))
  const audio = attachments.filter((a) => a.mime_type.startsWith('audio/'))

  const [imageResult, audioResult] = await Promise.all([
    images.length > 0
      ? supabase.storage.from(IMAGE_BUCKET).remove(images.map((a) => a.storage_path))
      : Promise.resolve({ error: null }),
    audio.length > 0
      ? supabase.storage.from(AUDIO_BUCKET).remove(audio.map((a) => a.storage_path))
      : Promise.resolve({ error: null }),
  ])
  if (imageResult.error) throw imageResult.error
  if (audioResult.error) throw audioResult.error
}
