export interface Entry {
  id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

export type NewEntry = Pick<Entry, 'content'> & {
  metadata?: Entry['metadata']
}

export type EntryUpdate = Partial<Pick<Entry, 'content' | 'metadata'>>
