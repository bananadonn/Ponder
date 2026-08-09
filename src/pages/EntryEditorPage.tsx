import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createEntry, deleteEntry, getEntry, updateEntry } from '../data/entries'

export default function EntryEditorPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew || !id) return
    getEntry(id)
      .then((entry) => setContent(entry.content))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load entry'))
      .finally(() => setLoading(false))
  }, [id, isNew])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        await createEntry({ content })
      } else if (id) {
        await updateEntry(id, { content })
      }
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!id || isNew) return
    if (!window.confirm('Delete this entry? This cannot be undone.')) return
    setSaving(true)
    try {
      await deleteEntry(id)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry')
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-8 text-sm text-stone-500">Loading…</div>
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate('/')} className="text-sm text-stone-500 hover:text-stone-900">
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {!isNew && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !content.trim()}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <textarea
        autoFocus
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write in markdown…"
        className="h-[70vh] w-full resize-none rounded-md border border-stone-300 p-4 font-mono text-sm leading-relaxed focus:border-stone-500 focus:outline-none"
      />
    </div>
  )
}
