import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { Editor, JSONContent } from '@tiptap/core'
import { createEntry, deleteEntry, getEntry, updateEntry } from '../data/entries'
import { docToPlainText, EMPTY_DOC, joinContent, plainTextToDoc, splitContent } from '../lib/richDoc'
import { extractHandTags } from '../lib/tags'
import { useEntryEditor, EntryEditorContent } from '../components/editor/EntryEditor'
import { insertImageAtSelection } from '../components/editor/uploadImage'
import { AudioRecorder, insertAudioAtSelection } from '../components/editor/recordAudio'
import type { ComposerContext } from './MainLayout'

const MAX_CHARS = 40000
const DRAFT_DELAY = 900

interface Draft {
  title: string
  doc: JSONContent
}

// Local drafts protect typed-but-unsaved text (e.g. a crash or refresh
// before a deliberate save) without writing to the DB on every keystroke
// pause — a DB write is what triggers re-embedding, so it's reserved for
// explicit saves and navigate-away flushes only.
function draftKey(entryId: string | null): string {
  return `ponder:draft:${entryId ?? 'new'}`
}

function readDraft(entryId: string | null): Draft | null {
  const raw = localStorage.getItem(draftKey(entryId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Draft
  } catch {
    return null
  }
}

function writeDraft(entryId: string | null, draft: Draft): void {
  localStorage.setItem(draftKey(entryId), JSON.stringify(draft))
}

function clearDraft(entryId: string | null): void {
  localStorage.removeItem(draftKey(entryId))
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

function AttachIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
    </svg>
  )
}

export default function EntryEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { onSaved, refresh, showList } = useOutletContext<ComposerContext>()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  // Always start loading, even for the id-less "new entry" route: the load
  // effect below still needs its first pass (checking for a local draft) to
  // land before the title-watching effect evaluates state, or a stray
  // render with still-blank state can wipe out a draft that's about to be
  // restored.
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'idle' | 'unsaved' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [charCount, setCharCount] = useState(0)
  const [recording, setRecording] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<AudioRecorder | null>(null)

  // Save machinery lives in refs so it survives renders without re-running
  // effects, and so the flush-on-navigate path below always sees the latest
  // values instead of a stale closure.
  const entryIdRef = useRef<string | null>(id ?? null)
  const lastSavedRef = useRef<string>('')
  const creatingPromiseRef = useRef<Promise<string> | null>(null)
  const justCreatedIdRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef('')
  const titleRef = useRef('')
  titleRef.current = title
  // Populated below once useEntryEditor() returns. Callbacks defined ahead
  // of that call (createEntryNow, saveNow, handleImageFiles) read the
  // editor through this ref rather than closing over the hook's return
  // value directly, so definition order doesn't matter — by the time any of
  // them actually run (always later, from an event), the ref is populated.
  const editorRef = useRef<Editor | null>(null)

  function recomputeContent(currentTitle: string, doc: JSONContent): string {
    const content = joinContent(currentTitle, docToPlainText(doc))
    contentRef.current = content
    setCharCount(content.length)
    return content
  }

  function handleContentChanged(content: string, doc: JSONContent) {
    if (content === lastSavedRef.current) {
      clearDraft(entryIdRef.current)
      setStatus((s) => (s === 'idle' ? 'idle' : 'saved'))
      return
    }
    setStatus('unsaved')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(
      () => writeDraft(entryIdRef.current, { title: titleRef.current, doc }),
      DRAFT_DELAY,
    )
  }

  const handleEditorUpdate = useCallback((doc: JSONContent) => {
    const content = recomputeContent(titleRef.current, doc)
    handleContentChanged(content, doc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Creates the entry row on first write (Save/Ctrl+S on a brand-new entry,
  // or the first image pasted/attached before anything's been saved).
  // Concurrent callers share one in-flight creation instead of double-
  // creating.
  const createEntryNow = useCallback(
    (opts: { navigateOnCreate: boolean } = { navigateOnCreate: true }): Promise<string> => {
      if (entryIdRef.current) return Promise.resolve(entryIdRef.current)
      if (!creatingPromiseRef.current) {
        creatingPromiseRef.current = (async () => {
          setError(null)
          setStatus('saving')
          try {
            const content = contentRef.current
            const doc = editorRef.current?.getJSON() ?? EMPTY_DOC
            const handTags = extractHandTags(content)
            const created = await createEntry({ content, content_doc: doc, metadata: handTags })
            entryIdRef.current = created.id
            lastSavedRef.current = content
            justCreatedIdRef.current = created.id
            clearDraft(null)
            setStatus('saved')
            if (opts.navigateOnCreate) {
              onSaved(created.id)
            } else {
              refresh()
            }
            return created.id
          } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Failed to save')
            throw err
          } finally {
            creatingPromiseRef.current = null
          }
        })()
      }
      return creatingPromiseRef.current
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSaved, refresh],
  )

  const saveNow = useCallback(
    async (content: string, opts: { navigateOnCreate: boolean } = { navigateOnCreate: true }) => {
      if (content === lastSavedRef.current) return
      setError(null)
      if (entryIdRef.current) {
        setStatus('saving')
        try {
          const doc = editorRef.current?.getJSON() ?? EMPTY_DOC
          const handTags = extractHandTags(content)
          await updateEntry(entryIdRef.current, { content, content_doc: doc, metadata: handTags })
          lastSavedRef.current = content
          clearDraft(entryIdRef.current)
          setStatus('saved')
          refresh()
        } catch (err) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Failed to save')
        }
        return
      }
      try {
        await createEntryNow(opts)
      } catch {
        // createEntryNow already set status/error
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createEntryNow, refresh],
  )

  async function handleImageFiles(files: File[]) {
    const editorInstance = editorRef.current
    if (!editorInstance || files.length === 0) return
    let entryId: string
    try {
      entryId = await createEntryNow()
    } catch {
      return
    }
    for (const file of files) {
      try {
        await insertImageAtSelection(editorInstance, file, entryId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload image')
      }
    }
  }

  async function handleToggleRecording() {
    if (recording) {
      setRecording(false)
      const recorder = recorderRef.current
      recorderRef.current = null
      if (!recorder) return
      try {
        const { blob, durationSeconds } = await recorder.stop()
        const editorInstance = editorRef.current
        if (!editorInstance) return
        const entryId = await createEntryNow()
        await insertAudioAtSelection(editorInstance, blob, durationSeconds, entryId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save recording')
      }
      return
    }

    try {
      const recorder = new AudioRecorder()
      await recorder.start()
      recorderRef.current = recorder
      setRecording(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access was denied')
    }
  }

  // If the user navigates away mid-recording, stop the mic rather than
  // leaving the track (and its "recording" indicator) running in the
  // background -- the in-progress audio is discarded, same as any other
  // unsaved-in-the-editor-but-never-committed input.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel()
    }
  }, [])

  const editor = useEntryEditor({ onUpdate: handleEditorUpdate, onImageFiles: handleImageFiles })
  editorRef.current = editor

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
    if (!editor) return

    if (!id) {
      entryIdRef.current = null
      lastSavedRef.current = ''
      const draft = readDraft(null)
      const draftTitle = draft?.title ?? ''
      const draftDoc = draft?.doc ?? EMPTY_DOC
      setTitle(draftTitle)
      titleRef.current = draftTitle
      editor.commands.setContent(draftDoc, { emitUpdate: false })
      recomputeContent(draftTitle, draftDoc)
      setStatus(draft ? 'unsaved' : 'idle')
      setLoading(false)
      setError(null)
    } else {
      setLoading(true)
      getEntry(id)
        .then((entry) => {
          entryIdRef.current = entry.id
          const dbDoc = entry.content_doc ?? plainTextToDoc(splitContent(entry.content).body)
          const dbTitle = splitContent(entry.content).title
          const dbContent = joinContent(dbTitle, docToPlainText(dbDoc))
          lastSavedRef.current = dbContent

          const draft = readDraft(entry.id)
          let finalTitle = dbTitle
          let finalDoc = dbDoc
          let initialStatus: 'idle' | 'unsaved' = 'idle'

          if (draft) {
            const draftContent = joinContent(draft.title, docToPlainText(draft.doc))
            if (draftContent !== dbContent) {
              finalTitle = draft.title
              finalDoc = draft.doc
              initialStatus = 'unsaved'
            } else {
              clearDraft(entry.id)
            }
          }

          setTitle(finalTitle)
          titleRef.current = finalTitle
          editor.commands.setContent(finalDoc, { emitUpdate: false })
          recomputeContent(finalTitle, finalDoc)
          setStatus(initialStatus)
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
  }, [id, editor])

  // Title lives in React state (it's a plain input, not part of the rich
  // doc) — mirror it into the same unsaved/draft machinery the editor's own
  // updates go through whenever it changes on its own.
  useEffect(() => {
    titleRef.current = title
    if (loading || !editor) return
    const doc = editor.getJSON()
    const content = recomputeContent(title, doc)
    handleContentChanged(content, doc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, loading, editor])

  // Ctrl/Cmd+S saves immediately instead of triggering the browser's dialog.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow(contentRef.current)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveNow])

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

  function handleAttachClick() {
    fileInputRef.current?.click()
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) await handleImageFiles(files)
  }

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
        <div className="flex items-center gap-3">
          <span className="text-xs text-mist-400">
            {status === 'unsaved' && 'Unsaved changes'}
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && 'Saved'}
            {status === 'error' && <span className="text-red-600">Not saved</span>}
          </span>
          <button
            onClick={() => saveNow(contentRef.current)}
            disabled={status === 'idle' || status === 'saved' || status === 'saving'}
            className="rounded-soft bg-mist-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-mist-700 disabled:cursor-not-allowed disabled:bg-mist-200 disabled:text-mist-400"
          >
            Save
          </button>
          {entryIdRef.current && (
            <button onClick={handleDelete} className="text-sm text-red-600 transition-colors hover:text-red-800">
              Delete
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-5 pt-3 text-sm text-red-600 md:px-8">{error}</p>}

      <div className="mx-auto flex w-full max-w-[clamp(42rem,60vw,72rem)] flex-1 flex-col px-5 py-6 md:px-8 md:py-10">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Today…"
          className="font-display mb-3 w-full border-none bg-transparent text-2xl font-extrabold text-mist-900 placeholder:text-mist-300 focus:outline-none"
        />
        <div className="min-h-[40vh] flex-1">
          <EntryEditorContent editor={editor} />
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-mist-200 pt-3">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <button
              type="button"
              onClick={handleAttachClick}
              className="flex items-center gap-1.5 rounded-soft px-1.5 py-1 text-xs font-medium text-mist-500 transition-colors hover:bg-mist-100 hover:text-mist-900"
            >
              <AttachIcon />
              Attach image
            </button>
            <button
              type="button"
              onClick={handleToggleRecording}
              className={`flex items-center gap-1.5 rounded-soft px-1.5 py-1 text-xs font-medium transition-colors ${
                recording ? 'text-red-600 hover:bg-red-50' : 'text-mist-500 hover:bg-mist-100 hover:text-mist-900'
              }`}
            >
              {recording ? <StopIcon /> : <MicIcon />}
              {recording ? 'Stop recording' : 'Record voice'}
            </button>
          </div>
          <p className="text-xs text-mist-400">
            {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}
