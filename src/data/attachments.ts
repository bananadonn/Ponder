import { supabase } from '../lib/supabase'
import type { Attachment } from './types'

/**
 * Framework-agnostic data-access functions for entry image attachments.
 * Mirrors the style of ./entries.ts.
 */

const BUCKET = 'entry-images'

// Signed URLs are requested for a full hour but cached for less, so a page
// that stays open a long time still refreshes before the URL expires.
const SIGNED_URL_TTL_SECONDS = 3600
const SIGNED_URL_CACHE_MARGIN_SECONDS = 600

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function uploadAttachment(entryId: string, file: File): Promise<Attachment> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Not authenticated')

  const storagePath = `${userData.user.id}/${entryId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type,
  })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      entry_id: entryId,
      user_id: userData.user.id,
      storage_path: storagePath,
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getSignedUrlCached(storagePath: string): Promise<string> {
  const cached = signedUrlCache.get(storagePath)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) throw error

  const expiresAt = Date.now() + (SIGNED_URL_TTL_SECONDS - SIGNED_URL_CACHE_MARGIN_SECONDS) * 1000
  signedUrlCache.set(storagePath, { url: data.signedUrl, expiresAt })
  return data.signedUrl
}

export async function listAttachmentsForEntry(entryId: string): Promise<Attachment[]> {
  const { data, error } = await supabase.from('attachments').select('*').eq('entry_id', entryId)
  if (error) throw error
  return data
}

// Removes the actual Storage objects for an entry's attachments. Must be
// called before deleting the entry row — the DB cascade on `attachments`
// only removes those rows, never the files sitting in Storage.
export async function deleteAttachmentsForEntry(entryId: string): Promise<void> {
  const attachments = await listAttachmentsForEntry(entryId)
  if (attachments.length === 0) return

  const { error } = await supabase.storage.from(BUCKET).remove(attachments.map((a) => a.storage_path))
  if (error) throw error
}
