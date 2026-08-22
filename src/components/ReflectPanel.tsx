import { FormEvent, useState } from 'react'
import { hybridSearch, type HybridSearchResponse } from '../data/search'
import { synthesizeAnswer } from '../data/synthesis'
import { EMOTION_LABELS } from '../data/emotions'
import type { QueryExtractionResult, SynthesisResult } from '../data/types'

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

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export default function ReflectPanel({
  onOpenEntry,
  onBack,
}: {
  onOpenEntry: (entryId: string) => void
  onBack: () => void
}) {
  const [query, setQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [emotions, setEmotions] = useState<string[]>([])
  const [entities, setEntities] = useState('')
  const [topics, setTopics] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [response, setResponse] = useState<HybridSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null)
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthesisError, setSynthesisError] = useState<string | null>(null)

  const hasQuery = query.trim().length > 0
  const hasFilters =
    emotions.length > 0 || entities.trim().length > 0 || topics.trim().length > 0 || !!startDate || !!endDate
  const canSubmit = hasQuery || hasFilters
  const activeFilterCount =
    emotions.length + (entities.trim() ? 1 : 0) + (topics.trim() ? 1 : 0) + (startDate ? 1 : 0) + (endDate ? 1 : 0)

  function toggleEmotion(emotion: string) {
    setEmotions((prev) => (prev.includes(emotion) ? prev.filter((e) => e !== emotion) : [...prev, emotion]))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || loading) return

    setLoading(true)
    setError(null)
    setSynthesis(null)
    setSynthesisError(null)
    try {
      const result = await hybridSearch(query, {
        emotions: emotions.length > 0 ? emotions : undefined,
        entities: entities.trim() ? splitList(entities) : undefined,
        topics: topics.trim() ? splitList(topics) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })
      setResponse(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSynthesize() {
    if (!response || !hasQuery || synthesizing) return

    setSynthesizing(true)
    setSynthesisError(null)
    try {
      setSynthesis(await synthesizeAnswer(query, response.matched, response.matched ? response.results : []))
    } catch (err) {
      setSynthesisError(err instanceof Error ? err.message : 'Failed to generate an answer')
    } finally {
      setSynthesizing(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mist-200 px-4 py-3">
        <button
          onClick={onBack}
          aria-label="Back to entries"
          className="flex items-center text-mist-500 transition-colors hover:text-mist-900 md:hidden"
        >
          <BackIcon />
        </button>
        <h2 className="font-display text-sm font-extrabold text-mist-900">Reflect</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask your journal…"
            className="w-full rounded-soft border border-mist-200 bg-white px-3 py-2 text-sm text-mist-900 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
          />

          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="flex items-center gap-1 text-xs font-medium text-mist-500 transition-colors hover:text-mist-900"
          >
            Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
            <ChevronIcon open={showFilters} />
          </button>

          {showFilters && (
            <div className="space-y-3 rounded-soft border border-mist-200 bg-white p-3">
              <div className="flex flex-wrap gap-1.5">
                {EMOTION_LABELS.map((emotion) => (
                  <button
                    key={emotion}
                    type="button"
                    onClick={() => toggleEmotion(emotion)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                      emotions.includes(emotion)
                        ? 'bg-mist-900 text-white'
                        : 'bg-mist-100 text-mist-600 hover:bg-mist-200'
                    }`}
                  >
                    {emotion}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                placeholder="Topics, comma separated"
                className="w-full rounded-soft border border-mist-200 px-2.5 py-1.5 text-sm text-mist-800 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
              />
              <input
                type="text"
                value={entities}
                onChange={(e) => setEntities(e.target.value)}
                placeholder="People or places, comma separated"
                className="w-full rounded-soft border border-mist-200 px-2.5 py-1.5 text-sm text-mist-800 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
              />
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-soft border border-mist-200 px-2.5 py-1.5 text-sm text-mist-800 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
                />
                <span className="text-xs text-mist-400">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-soft border border-mist-200 px-2.5 py-1.5 text-sm text-mist-800 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full rounded-soft bg-mist-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-mist-700 disabled:cursor-not-allowed disabled:bg-mist-200 disabled:text-mist-400"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {response?.extractedFilters && <ExtractedFiltersChips extraction={response.extractedFilters} />}

        {response && !response.matched && (
          <p className="mt-4 rounded-soft bg-mist-100 px-3 py-2.5 text-sm text-mist-600">
            {response.message ?? 'No matching entries found.'}
          </p>
        )}

        {response && (
          <div className="mt-4">
            <button
              type="button"
              onClick={handleSynthesize}
              disabled={synthesizing || !hasQuery}
              className="w-full rounded-soft border border-mist-200 bg-white px-3 py-1.5 text-sm font-medium text-mist-700 transition-colors hover:bg-mist-100 disabled:cursor-not-allowed disabled:text-mist-300"
            >
              {synthesizing ? 'Generating answer…' : 'Generate answer'}
            </button>
            {synthesisError && <p className="mt-2 text-sm text-red-600">{synthesisError}</p>}
            {synthesis && (
              <div
                className={`mt-3 rounded-soft border px-3 py-2.5 text-sm ${
                  synthesis.grounded ? 'border-mist-200 bg-mist-50 text-mist-800' : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {!synthesis.grounded && (
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-600">Not grounded</p>
                )}
                <p className="whitespace-pre-wrap">{synthesis.answer}</p>
              </div>
            )}
          </div>
        )}

        {response && response.matched && (
          <div className="mt-4 space-y-1.5">
            {response.results.map((result) => (
              <button
                key={result.chunk_id}
                onClick={() => onOpenEntry(result.entry_id)}
                className={`block w-full rounded-soft border px-3 py-2.5 text-left transition-colors hover:bg-mist-100 ${
                  synthesis?.cited_chunk_ids.includes(result.chunk_id)
                    ? 'border-mist-400 bg-mist-50'
                    : 'border-mist-200 bg-white'
                }`}
              >
                <p className="mb-0.5 text-xs font-medium text-mist-500">
                  {new Date(result.entry_created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  {synthesis?.cited_chunk_ids.includes(result.chunk_id) && (
                    <span className="ml-1.5 rounded-full bg-mist-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      cited
                    </span>
                  )}
                </p>
                <p className="line-clamp-3 text-sm text-mist-800">{result.text}</p>
              </button>
            ))}
          </div>
        )}
      </div>
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
