import { FormEvent, useEffect, useRef, useState } from 'react'
import SearchBar from './SearchBar'
import ReflectionChat, { type ReflectMessage } from './ReflectionChat'
import { hybridSearch, searchChunksSubstring, type ChunkMatch, type HybridSearchResponse } from '../data/search'
import { reflectChat } from '../data/reflect'
import type { HybridFilters, QueryExtractionResult } from '../data/types'

// Reflect is the primary experience; raw search is an opt-in toggle rather
// than a co-equal tab (see the "raw search" switch in the header below).
type Mode = 'reflect' | 'search'

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// A compact on/off switch rather than a second tab — raw search is a
// deliberate detour from the default Reflect experience, not an equal
// alternative to it.
function RawSearchToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      className="flex items-center gap-2 rounded-soft py-1 pl-1 pr-0.5 text-xs font-medium transition-colors"
    >
      <span className={active ? 'text-mist-900' : 'text-mist-500'}>Raw search</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-mist-300 focus-visible:ring-offset-1 ${
          active ? 'bg-mist-900' : 'bg-mist-200'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            active ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
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
  const [mode, setMode] = useState<Mode>('reflect')
  const [query, setQuery] = useState('')

  // A date range scoped to this panel, layered on top of whatever the Rack's
  // own filters currently are — lets a date be set for reflect/search
  // without leaving this panel or disturbing the Rack's own entry list.
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const effectiveFilters: HybridFilters = {
    ...filters,
    startDate: dateStart || filters.startDate,
    endDate: dateEnd || filters.endDate,
  }
  const activeDateCount = (dateStart ? 1 : 0) + (dateEnd ? 1 : 0)
  const filtersKey = JSON.stringify(effectiveFilters)

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
  // survives switching to raw search and back, since this component only
  // mounts ReflectionChat while mode === 'reflect'.
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
      searchChunksSubstring(query, effectiveFilters)
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
      // a hard post-filter over everything. So a real constraint is applied
      // here instead: run the vector search unconstrained (auto-extraction
      // still enriches it and drives the "Understood as" chips), then
      // intersect against the same filter_chunks predicate the Rack itself
      // uses.
      const response = await hybridSearch(query)
      let results = response.results
      let matched = response.matched
      let message = response.message

      if (hasActiveFilters(effectiveFilters) && response.matched) {
        const allowed = await searchChunksSubstring('', effectiveFilters)
        const allowedIds = new Set(allowed.map((c) => c.chunk_id))
        results = results.filter((r) => allowedIds.has(r.chunk_id))
        matched = results.length > 0
        message = matched ? undefined : 'No results match the current filters.'
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
      const response = await reflectChat(message, history, effectiveFilters)
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

  function clearDateFilter() {
    setDateStart('')
    setDateEnd('')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mist-200 px-3 py-2">
        <button
          type="button"
          onClick={() => setShowDateFilter((s) => !s)}
          className="flex items-center gap-1 text-xs font-medium text-mist-500 transition-colors hover:text-mist-900"
        >
          Date{activeDateCount > 0 && ` (${activeDateCount})`}
          <ChevronIcon open={showDateFilter} />
        </button>
        {activeDateCount > 0 && (
          <button
            type="button"
            onClick={clearDateFilter}
            aria-label="Clear date filter"
            className="text-xs font-medium text-mist-400 transition-colors hover:text-mist-700"
          >
            Clear
          </button>
        )}
        <div className="flex-1" />
        <RawSearchToggle active={mode === 'search'} onToggle={() => setMode((m) => (m === 'search' ? 'reflect' : 'search'))} />
      </div>

      {showDateFilter && (
        <div className="flex items-center gap-2 border-b border-mist-200 bg-mist-50 px-3 py-2.5">
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="w-full min-w-0 rounded-soft border border-mist-200 bg-white px-2.5 py-1.5 text-sm text-mist-800 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
          />
          <span className="shrink-0 text-xs text-mist-400">to</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="w-full min-w-0 rounded-soft border border-mist-200 bg-white px-2.5 py-1.5 text-sm text-mist-800 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
          />
        </div>
      )}

      {mode === 'search' ? (
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
