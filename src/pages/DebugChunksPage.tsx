import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listEntries } from '../data/entries'
import { listChunksForEntry } from '../data/chunks'
import { reprocessEntry } from '../data/processing'
import type { Chunk, Entry } from '../data/types'

const STATUS_STYLES: Record<Entry['processing_status'], string> = {
  pending: 'bg-stone-100 text-stone-600',
  processing: 'bg-amber-100 text-amber-700',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

export default function DebugChunksPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chunksByEntry, setChunksByEntry] = useState<Record<string, Chunk[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refreshEntries() {
    setLoading(true)
    try {
      setEntries(await listEntries())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshEntries()
  }, [])

  async function toggleExpand(entryId: string) {
    if (expandedId === entryId) {
      setExpandedId(null)
      return
    }
    setExpandedId(entryId)
    if (!chunksByEntry[entryId]) {
      try {
        const chunks = await listChunksForEntry(entryId)
        setChunksByEntry((prev) => ({ ...prev, [entryId]: chunks }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chunks')
      }
    }
  }

  async function handleReprocess(entryId: string) {
    setBusyId(entryId)
    setError(null)
    try {
      await reprocessEntry(entryId)
      const chunks = await listChunksForEntry(entryId)
      setChunksByEntry((prev) => ({ ...prev, [entryId]: chunks }))
      await refreshEntries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reprocess entry')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-stone-900">Debug: chunks & embeddings</h1>
        <div className="flex items-center gap-4">
          <Link to="/debug/search" className="text-sm text-stone-500 hover:text-stone-900">
            Search debug →
          </Link>
          <Link to="/" className="text-sm text-stone-500 hover:text-stone-900">
            ← Back to entries
          </Link>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-stone-500">Loading…</p>}

      <div className="space-y-2">
        {entries.map((entry) => {
          const isExpanded = expandedId === entry.id
          const chunks = chunksByEntry[entry.id]

          return (
            <div key={entry.id} className="rounded-md border border-stone-200">
              <div className="flex items-center justify-between px-4 py-3">
                <button onClick={() => toggleExpand(entry.id)} className="flex-1 text-left">
                  <p className="text-sm text-stone-800">
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {entry.content.replace(/\s+/g, ' ').trim().slice(0, 100)}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[entry.processing_status]}`}
                  >
                    {entry.processing_status}
                  </span>
                  <button
                    onClick={() => handleReprocess(entry.id)}
                    disabled={busyId === entry.id}
                    className="text-xs text-stone-500 hover:text-stone-900 disabled:opacity-50"
                  >
                    {busyId === entry.id ? 'Reprocessing…' : 'Reprocess'}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="space-y-2 border-t border-stone-200 px-4 py-3">
                  {!chunks && <p className="text-xs text-stone-500">Loading chunks…</p>}
                  {chunks && chunks.length === 0 && (
                    <p className="text-xs text-stone-500">No chunks yet.</p>
                  )}
                  {chunks?.map((chunk) => (
                    <div key={chunk.id} className="rounded bg-stone-50 p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs text-stone-500">
                        <span>#{chunk.chunk_index}</span>
                        <span>{chunk.text.length} chars</span>
                        <span className={chunk.has_embedding ? 'text-green-700' : 'text-amber-700'}>
                          {chunk.has_embedding ? 'embedded' : 'no embedding'}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-stone-800">{chunk.text}</p>

                      {chunk.metadata ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-stone-200 pt-2">
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                            {chunk.metadata.emotion}
                            {chunk.metadata.emotion_confidence != null &&
                              ` (${Math.round(chunk.metadata.emotion_confidence * 100)}%)`}
                          </span>
                          {chunk.metadata.intensity != null && (
                            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">
                              intensity {chunk.metadata.intensity}/5
                            </span>
                          )}
                          {chunk.metadata.topics?.map((topic) => (
                            <span key={topic} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700">
                              {topic}
                            </span>
                          ))}
                          {chunk.metadata.entities?.map((entity) => (
                            <span key={entity} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                              {entity}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 border-t border-stone-200 pt-2 text-xs text-stone-400">
                          No metadata extracted yet.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
