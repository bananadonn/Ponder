import type { JSONContent } from '@tiptap/core'
import { supabase } from '../lib/supabase'
import { decryptOrPassthrough, encrypt } from '../lib/crypto'
import { getSessionDek } from '../lib/sessionKey'
import { deleteAttachmentsForEntry } from './attachments'
import { hybridSearch } from './search'
import type { Entry, EntryUpdate, HybridFilters, NewEntry } from './types'

/**
 * Framework-agnostic data-access functions for journal entries.
 * No React here — this module is shared with mobile/desktop clients later.
 */

// DB wire shape: content/content_doc are encrypted text blobs (or legacy
// plaintext) on the way in and out of Postgres, never the parsed
// JSONContent the rest of the app works with -- decryptEntry/the encrypt*
// helpers below are the only place that shape ever crosses into an `Entry`.
type EntryRow = Omit<Entry, 'content_doc'> & { content_doc: string | null }

async function decryptEntry(row: EntryRow): Promise<Entry> {
  const dek = await getSessionDek()
  const content = (await decryptOrPassthrough(dek, row.content))!
  const contentDocText = await decryptOrPassthrough(dek, row.content_doc)
  const content_doc: JSONContent | null = contentDocText ? JSON.parse(contentDocText) : null
  return { ...row, content, content_doc }
}

async function decryptEntries(rows: EntryRow[]): Promise<Entry[]> {
  return Promise.all(rows.map(decryptEntry))
}

async function encryptContent(content: string): Promise<string> {
  const dek = await getSessionDek()
  return encrypt(dek, content)
}

async function encryptContentDoc(contentDoc: JSONContent | null | undefined): Promise<string | null | undefined> {
  if (contentDoc === undefined) return undefined
  if (contentDoc === null) return null
  const dek = await getSessionDek()
  return encrypt(dek, JSON.stringify(contentDoc))
}

export async function listEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return decryptEntries(data)
}

function hasActiveFilters(filters: HybridFilters): boolean {
  return Boolean(
    filters.emotions?.length || filters.entities?.length || filters.topics?.length || filters.startDate || filters.endDate,
  )
}

// Deterministic (non-text) filtering for the Rack panel. Delegates to
// hybrid-search's existing filter-only path — with no query, that edge
// function runs a pure filter_chunks SQL lookup and never touches
// embeddings/OpenAI (see supabase/functions/hybrid-search/index.ts) — then
// resolves the matching chunks back to their parent entries, since the Rack
// browses entries, not chunks.
export async function listEntriesByFilters(filters: HybridFilters): Promise<Entry[]> {
  if (!hasActiveFilters(filters)) return listEntries()

  const response = await hybridSearch('', filters, { autoExtractFilters: false })
  if (!response.matched) return []

  const entryIds = [...new Set(response.results.map((r) => r.entry_id))]
  const { data, error } = await supabase.from('entries').select('*').in('id', entryIds)
  if (error) throw error

  const decrypted = await decryptEntries(data)
  const byId = new Map(decrypted.map((e) => [e.id, e]))
  return entryIds.map((id) => byId.get(id)).filter((e): e is Entry => !!e)
}

export async function getEntry(id: string): Promise<Entry> {
  const { data, error } = await supabase.from('entries').select('*').eq('id', id).single()

  if (error) throw error
  return decryptEntry(data)
}

export async function createEntry(entry: NewEntry): Promise<Entry> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('entries')
    .insert({
      ...entry,
      user_id: userData.user.id,
      content: await encryptContent(entry.content),
      content_doc: await encryptContentDoc(entry.content_doc),
    })
    .select()
    .single()

  if (error) throw error
  return decryptEntry(data)
}

export async function updateEntry(id: string, update: EntryUpdate): Promise<Entry> {
  const { data, error } = await supabase
    .from('entries')
    .update({
      ...update,
      content: update.content !== undefined ? await encryptContent(update.content) : undefined,
      content_doc: await encryptContentDoc(update.content_doc),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return decryptEntry(data)
}

export async function deleteEntry(id: string): Promise<void> {
  // Storage objects first: the DB cascade below only removes the
  // `attachments` rows, never the actual files sitting in Storage.
  await deleteAttachmentsForEntry(id)
  const { error } = await supabase.from('entries').delete().eq('id', id)
  if (error) throw error
}
