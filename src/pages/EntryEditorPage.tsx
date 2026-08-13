import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { createEntry, deleteEntry, getEntry, updateEntry } from '../data/entries'
import type { ComposerContext } from './MainLayout'

const MAX_CHARS = 40000
const AUTOSAVE_DELAY = 900

function splitContent(content: string): { title: string; body: string } {
  const newline = content.indexOf('\n')
  if (newline === -1) return { title: content, body: '' }
  return { title: content.slice(0, newline), body: content.slice(newline + 1).replace(/^\n+/, '') }
}

function joinContent(title: string, body: string): string {
  const t = title.trim()
  const b = body.trim()
  if (t && b) return `${t}\n\n${b}`
  return t || b
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 19 8 12l7-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function EntryEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { onSaved, refresh, showList } = useOutletContext<ComposerContext>()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(!!id)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [topics, setTopics] = useState('')
  const [entities, setEntities] = useState('')

  // Save machinery lives in refs so it survives renders without re-running
  // effects, and so the flush-on-navigate path below always sees the latest
  // values instead of a stale closure.
  const entryIdRef = useRef<string | null>(id ?? null)
  const lastSavedRef = useRef<string>('')
  const creatingRef = useRef(false)
  const justCreatedIdRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef('')
  contentRef.current = joinContent(title, body)

  const saveNow = useCallback(
    async (content: string, opts: { navigateOnCreate: boolean } = { navigateOnCreate: true }) => {
      if (content === lastSavedRef.current) return
      setError(null)
      if (entryIdRef.current) {
        setStatus('saving')
        try {
          await updateEntry(entryIdRef.current, { content })
          lastSavedRef.current = content
          setStatus('saved')
          refresh()
        } catch (err) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Failed to save')
        }
        return
      }
      if (creatingRef.current) return
      creatingRef.current = true
      setStatus('saving')
      try {
        const created = await createEntry({ content })
        entryIdRef.current = created.id
        lastSavedRef.current = content
        justCreatedIdRef.current = created.id
        setStatus('saved')
        if (opts.navigateOnCreate) {
          onSaved(created.id)
        } else {
          refresh()
        }
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to save')
      } finally {
        creatingRef.current = false
      }
    },
    [onSaved, refresh],
  )

  // Load whichever entry the route points at; reset to a blank composer for
  // the index route. The cleanup flushes any unsaved edits before switching
  // to a different entry (or unmounting), so a quick click to another entry
  // never silently drops what was just typed.
  useEffect(() => {
    if (id && justCreatedIdRef.current === id) {
      justCreatedIdRef.current = null
      setLoading(false)
      return
    }

    if (!id) {
      entryIdRef.current = null
      lastSavedRef.current = ''
      setTitle('')
      setBody('')
      setLoading(false)
      setStatus('idle')
      setError(null)
    } else {
      setLoading(true)
      getEntry(id)
        .then((entry) => {
          const split = splitContent(entry.content)
          entryIdRef.current = entry.id
          lastSavedRef.current = entry.content
          setTitle(split.title)
          setBody(split.body)
          setStatus('idle')
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load entry'))
        .finally(() => setLoading(false))
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const pending = contentRef.current
      if (pending && pending !== lastSavedRef.current) {
        saveNow(pending, { navigateOnCreate: false })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Debounce edits.
  useEffect(() => {
    if (loading) return
    const content = joinContent(title, body)
    if (content === lastSavedRef.current) return

    debounceRef.current = setTimeout(() => saveNow(content), AUTOSAVE_DELAY)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [title, body, loading, saveNow])

  async function handleDelete() {
    const currentId = entryIdRef.current
    if (!currentId) return
    if (!window.confirm('Delete this entry? This cannot be undone.')) return
    try {
      await deleteEntry(currentId)
      refresh()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry')
    }
  }

  const charCount = joinContent(title, body).length

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-mist-500">Loading…</div>
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-mist-200 px-5 py-2.5 md:px-8">
        <button
          onClick={showList}
          className="flex items-center gap-1 text-sm font-medium text-mist-500 transition-colors hover:text-mist-900 md:hidden"
        >
          <BackIcon />
          Entries
        </button>
        <span className="text-xs text-mist-400">
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && <span className="text-red-600">Not saved</span>}
        </span>
        {entryIdRef.current && (
          <button onClick={handleDelete} className="text-sm text-red-600 transition-colors hover:text-red-800">
            Delete
          </button>
        )}
      </div>

      {error && <p className="px-5 pt-3 text-sm text-red-600 md:px-8">{error}</p>}

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-6 md:px-8 md:py-10">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Today…"
          className="font-display mb-3 w-full border-none bg-transparent text-2xl font-extrabold text-mist-900 placeholder:text-mist-300 focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write in markdown…"
          className="min-h-[40vh] resize-none border-none bg-transparent font-mono text-sm leading-relaxed text-mist-800 placeholder:text-mist-400 focus:outline-none"
        />

        <div className="mt-6 space-y-2.5 border-t border-mist-200 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-mist-400" htmlFor="entry-topics">
              Topics
            </label>
            <input
              id="entry-topics"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder="comma, separated"
              className="min-w-[160px] flex-1 rounded-soft border border-mist-200 bg-white px-2.5 py-1.5 text-sm text-mist-800 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-mist-400" htmlFor="entry-entities">
              Entities
            </label>
            <input
              id="entry-entities"
              value={entities}
              onChange={(e) => setEntities(e.target.value)}
              placeholder="comma, separated"
              className="min-w-[160px] flex-1 rounded-soft border border-mist-200 bg-white px-2.5 py-1.5 text-sm text-mist-800 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
            />
          </div>
          <p className="text-right text-xs text-mist-400">
            {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}
