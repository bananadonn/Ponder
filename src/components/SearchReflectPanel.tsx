import { FormEvent, useEffect, useRef, useState } from 'react'
import SearchBar from './SearchBar'
import ReflectionChat, { type ReflectMessage } from './ReflectionChat'
import { hybridSearch, searchChunksSubstring, type ChunkMatch, type HybridSearchResponse } from '../data/search'
import { reflectChat } from '../data/reflect'
import type { HybridFilters, QueryExtractionResult } from '../data/types'

type Mode = 'retrieval' | 'reflection'

const LIVE_SEARCH_DEBOUNCE = 150
// Bounds how much conversation gets sent (and re-sent) to the model each
// turn — a personal reflection session isn't expected to run past a few
// dozen exchanges, but nothing should grow unbounded.
const MAX_HISTORY_MESSAGES = 8

function hasActiveFilters(filters: HybridFilters): boolean {
  return Boolean(
    filters.emotions?.length || filters.entities?.length || filters.topics?.length || filters.startDate || filters.endDate,
  )
}

interface Submitted {
  query: string
  filtersKey: string
  response: HybridSearchResponse
}

export default function SearchReflectPanel({
  onOpenEntry,
  filters,
}: {
  onOpenEntry: (entryId: string) => void
  filters: HybridFilters
}) {
  const [mode, setMode] = useState<Mode>('retrieval')
  const [query, setQuery] = useState('')
  const filtersKey = JSON.stringify(filters)

  // Every keystroke: an instant, filter-constrained substring match (no
  // embeddings/OpenAI call). Enter escalates to the full vector-embedding
  // pass below — `submitted` is only shown while its query and filters still
  // match the current input/Rack state; editing either falls back to the
  // live substring view automatically rather than showing a stale answer.
  const [liveResults, setLiveResults] = useState<ChunkMatch[]>([])
  const [liveLoading, setLiveLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [submitted, setSubmitted] = useState<Submitted | null>(null)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reflection mode's chat — lifted here (not owned by ReflectionChat) so it
  // survives switching to Retrieval and back, since this component only
  // mounts ReflectionChat while mode === 'reflection'.
  const [reflectMessages, setReflectMessages] = useState<ReflectMessage[]>([])
  const [reflectLoading, setReflectLoading] = useState(false)
  const [reflectError, setReflectError] = useState<string | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setLiveResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      setLiveLoading(true)
      searchChunksSubstring(query, filters)
        .then(setLiveResults)
        .catch(() => setLiveResults([]))
        .finally(() => setLiveLoading(false))
    }, LIVE_SEARCH_DEBOUNCE)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filtersKey])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!query.trim() || submitLoading) return

    setSubmitLoading(true)
    setSubmitError(null)
    try {
      // hybrid-search's own `filters` param UNIONs manual filters into the
      // result set (extra recall) rather than constraining it — the one
      // exception is date range, which the edge function already applies as
      // a hard post-filter over everything. So a real Rack-filter
      // constraint is applied here instead: run the vector search
      // unconstrained (auto-extraction still enriches it and drives the
      // "Understood as" chips), then intersect against the same
      // filter_chunks predicate the Rack itself uses.
      const response = await hybridSearch(query)
      let results = response.results
      let matched = response.matched
      let message = response.message

      if (hasActiveFilters(filters) && response.matched) {
        const allowed = await searchChunksSubstring('', filters)
        const allowedIds = new Set(allowed.map((c) => c.chunk_id))
        results = results.filter((r) => allowedIds.has(r.chunk_id))
        matched = results.length > 0
        message = matched ? undefined : 'No results match the current Rack filters.'
      }

      setSubmitted({ query, filtersKey, response: { ...response, results, matched, message } })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSubmitLoading(false)
    }
  }

  const showSubmitted = submitted && submitted.query === query && submitted.filtersKey === filtersKey

  async function handleReflectSend(message: string) {
    const userMessage: ReflectMessage = { role: 'user', content: message }
    const nextMessages = [...reflectMessages, userMessage]
    setReflectMessages(nextMessages)
    setReflectLoading(true)
    setReflectError(null)
    try {
      const history = nextMessages
        .slice(-MAX_HISTORY_MESSAGES)
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }))
      const response = await reflectChat(message, history, filters)
      setReflectMessages((prev) => [
        ...prev,
        { role: 'assistant', content: response.answer, citations: response.citations },
      ])
    } catch (err) {
      setReflectError(err instanceof Error ? err.message : 'Reflection failed')
    } finally {
      setReflectLoading(false)
    }
  }

  function handleNewReflection() {
    setReflectMessages([])
    setReflectError(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-mist-200 p-1.5">
        <button
          type="button"
          onClick={() => setMode('retrieval')}
          className={`flex-1 rounded-soft px-2 py-1.5 text-xs font-semibold transition-colors ${
            mode === 'retrieval' ? 'bg-mist-900 text-white' : 'text-mist-500 hover:bg-mist-100'
          }`}
        >
          Retrieval
        </button>
        <button
          type="button"
          onClick={() => setMode('reflection')}
          className={`flex-1 rounded-soft px-2 py-1.5 text-xs font-semibold transition-colors ${
            mode === 'reflection' ? 'bg-mist-900 text-white' : 'text-mist-500 hover:bg-mist-100'
          }`}
        >
          Reflection
        </button>
      </div>

      {mode === 'retrieval' ? (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <form onSubmit={handleSubmit}>
            <SearchBar value={query} onChange={setQuery} placeholder="Search your journal…" />
          </form>

          {showSubmitted ? (
            <>
              {submitError && <p className="mt-4 text-sm text-red-600">{submitError}</p>}
              {submitted.response.extractedFilters && (
                <ExtractedFiltersChips extraction={submitted.response.extractedFilters} />
              )}
              {!submitted.response.matched && (
                <p className="mt-4 rounded-soft bg-mist-100 px-3 py-2.5 text-sm text-mist-600">
                  {submitted.response.message ?? 'No matching entries found.'}
                </p>
              )}
              {submitted.response.matched && (
                <ResultList results={submitted.response.results} onOpenEntry={onOpenEntry} />
              )}
            </>
          ) : (
            <>
              {submitError && <p className="mt-4 text-sm text-red-600">{submitError}</p>}
              {query.trim() && liveLoading && liveResults.length === 0 && (
                <p className="mt-4 text-sm text-mist-500">Searching…</p>
              )}
              {query.trim() && !liveLoading && liveResults.length === 0 && (
                <p className="mt-4 rounded-soft bg-mist-100 px-3 py-2.5 text-sm text-mist-600">
                  No matching text found. Press enter to try a deeper search.
                </p>
              )}
              {liveResults.length > 0 && <ResultList results={liveResults} onOpenEntry={onOpenEntry} />}
            </>
          )}
        </div>
      ) : (
        <ReflectionChat
          messages={reflectMessages}
          loading={reflectLoading}
          error={reflectError}
          onSend={handleReflectSend}
          onOpenEntry={onOpenEntry}
          onNewReflection={handleNewReflection}
        />
      )}
    </div>
  )
}

function ResultList({
  results,
  onOpenEntry,
}: {
  results: { chunk_id: string; entry_id: string; text: string; entry_created_at: string }[]
  onOpenEntry: (entryId: string) => void
}) {
  return (
    <div className="mt-4 space-y-1.5">
      {results.map((result) => (
        <button
          key={result.chunk_id}
          onClick={() => onOpenEntry(result.entry_id)}
          className="block w-full rounded-soft border border-mist-200 bg-white px-3 py-2.5 text-left transition-colors hover:bg-mist-100"
        >
          <p className="mb-0.5 text-xs font-medium text-mist-500">
            {new Date(result.entry_created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
          <p className="line-clamp-3 text-sm text-mist-800">{result.text}</p>
        </button>
      ))}
    </div>
  )
}

function ExtractedFiltersChips({ extraction }: { extraction: QueryExtractionResult }) {
  const hasAnything =
    extraction.emotion.value.length > 0 || extraction.topics.value.length > 0 || extraction.entities.value.length > 0
  if (!hasAnything) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-mist-400">Understood as</span>
      {extraction.emotion.value.map((emotion) => (
        <span key={`emotion-${emotion}`} className="rounded-full bg-mist-100 px-2 py-0.5 text-xs text-mist-600">
          {emotion}
        </span>
      ))}
      {extraction.topics.value.map((topic) => (
        <span key={`topic-${topic}`} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
          #{topic}
        </span>
      ))}
      {extraction.entities.value.map((entity) => (
        <span key={`entity-${entity}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
          @{entity}
        </span>
      ))}
    </div>
  )
}
