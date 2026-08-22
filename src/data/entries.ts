import { supabase } from '../lib/supabase'
import { deleteAttachmentsForEntry } from './attachments'
import type { Entry, EntryUpdate, NewEntry } from './types'

/**
 * Framework-agnostic data-access functions for journal entries.
 * No React here — this module is shared with mobile/desktop clients later.
 */

export async function listEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function searchEntries(query: string): Promise<Entry[]> {
  const trimmed = query.trim()
  if (!trimmed) return listEntries()

  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .ilike('content', `%${trimmed}%`)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getEntry(id: string): Promise<Entry> {
  const { data, error } = await supabase.from('entries').select('*').eq('id', id).single()

  if (error) throw error
  return data
}

export async function createEntry(entry: NewEntry): Promise<Entry> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('entries')
    .insert({ ...entry, user_id: userData.user.id })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateEntry(id: string, update: EntryUpdate): Promise<Entry> {
  const { data, error } = await supabase
    .from('entries')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteEntry(id: string): Promise<void> {
  // Storage objects first: the DB cascade below only removes the
  // `attachments` rows, never the actual files sitting in Storage.
  await deleteAttachmentsForEntry(id)
  const { error } = await supabase.from('entries').delete().eq('id', id)
  if (error) throw error
}
