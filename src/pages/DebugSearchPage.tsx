import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { hybridSearch, type HybridSearchResponse } from '../data/search'
import { synthesizeAnswer } from '../data/synthesis'
import { EMOTION_LABELS } from '../data/emotions'
import type { EmbeddingStrategy, QueryExtractionResult, ResultSource, SynthesisResult } from '../data/types'

const DEFAULT_THRESHOLD = 0.3
const DEFAULT_LIMIT = 20

const SOURCE_STYLES: Record<ResultSource, string> = {
  vector: 'bg-sky-100 text-sky-700',
  structured: 'bg-purple-100 text-purple-700',
  both: 'bg-green-100 text-green-700',
}

export default function DebugSearchPage() {
  const [query, setQuery] = useState('')
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [embeddingStrategy, setEmbeddingStrategy] = useState<EmbeddingStrategy>('hyde')
  const [autoExtractFilters, setAutoExtractFilters] = useState(true)
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

  function toggleEmotion(emotion: string) {
    setEmotions((prev) => (prev.includes(emotion) ? prev.filter((e) => e !== emotion) : [...prev, emotion]))
  }

  function splitList(value: string): string[] {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)
    setSynthesis(null)
    setSynthesisError(null)
    try {
      const result = await hybridSearch(
        query,
        {
          emotions: emotions.length > 0 ? emotions : undefined,
          entities: entities.trim() ? splitList(entities) : undefined,
          topics: topics.trim() ? splitList(topics) : undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        },
        { threshold, vectorLimit: limit, filterLimit: limit, embeddingStrategy, autoExtractFilters },
      )
      setResponse(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSynthesize() {
    if (!response || !hasQuery) return

    setSynthesizing(true)
    setSynthesisError(null)
    try {
      setSynthesis(await synthesizeAnswer(query, response.matched, response.matched ? response.results : []))
    } catch (err) {
      setSynthesisError(err instanceof Error ? err.message : 'Synthesis failed')
    } finally {
      setSynthesizing(false)
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-stone-900">Debug: hybrid search</h1>
        <Link to="/debug/chunks" className="text-sm text-stone-500 hover:text-stone-900">
          Chunks debug →
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="mb-6 space-y-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question… (optional if filters are set)"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
        />

        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-stone-600">
            Similarity threshold
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="mt-1 block w-24 rounded-md border border-stone-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-stone-600">
            Max results (per arm)
            <input
              type="number"
              step="1"
              min="1"
              max="100"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="mt-1 block w-24 rounded-md border border-stone-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="text-xs text-stone-600">
            Vector embedding strategy
            <div className="mt-1 flex overflow-hidden rounded-md border border-stone-300">
              {(['hyde', 'raw'] as const).map((strategy) => (
                <button
                  key={strategy}
                  type="button"
                  onClick={() => setEmbeddingStrategy(strategy)}
                  className={`px-2 py-1 text-sm ${
                    embeddingStrategy === strategy
                      ? 'bg-stone-900 text-white'
                      : 'bg-white text-stone-600 hover:bg-stone-100'
                  }`}
                >
                  {strategy === 'hyde' ? 'HyDE' : 'Raw question'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-stone-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-stone-600">Structured filters</p>
            <label className="flex items-center gap-1.5 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={autoExtractFilters}
                onChange={(e) => setAutoExtractFilters(e.target.checked)}
              />
              Auto-extract from question
            </label>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {EMOTION_LABELS.map((emotion) => (
              <button
                key={emotion}
                type="button"
                onClick={() => toggleEmotion(emotion)}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  emotions.includes(emotion)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {emotion}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-stone-600">
              Entities (comma-separated)
              <input
                type="text"
                value={entities}
                onChange={(e) => setEntities(e.target.value)}
                placeholder="Caty, Mr. Leslie"
                className="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-stone-600">
              Topics (comma-separated)
              <input
                type="text"
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                placeholder="sickness, family activities"
                className="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-stone-600">
              From date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-stone-600">
              To date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        {!canSubmit && <p className="text-xs text-stone-400">Enter a question and/or set at least one filter.</p>}
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {response && !response.matched && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {response.message ?? 'No matches.'}
        </div>
      )}

      {response?.extractedFilters && <ExtractedFiltersPanel extraction={response.extractedFilters} />}

      {response && (
        <div className="mb-6">
          <button
            type="button"
            onClick={handleSynthesize}
            disabled={synthesizing || !hasQuery}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {synthesizing ? 'Generating answer…' : 'Generate answer'}
          </button>
          {!hasQuery && <p className="mt-1 text-xs text-stone-400">Synthesis needs a question, not just filters.</p>}
          {synthesisError && <p className="mt-2 text-sm text-red-600">{synthesisError}</p>}
          {synthesis && (
            <div
              className={`mt-3 rounded-md border px-4 py-3 text-sm ${
                synthesis.grounded
                  ? 'border-stone-300 bg-stone-50 text-stone-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">
                {synthesis.grounded ? 'Answer' : 'Not grounded'}
              </p>
              <p className="whitespace-pre-wrap">{synthesis.answer}</p>
            </div>
          )}
        </div>
      )}

      {response && response.matched && (
        <div>
          <p className="mb-2 text-xs text-stone-500">
            {response.results.length} result{response.results.length === 1 ? '' : 's'}
            {' · embedded via '}
            <span className="font-medium text-stone-700">
              {response.embeddingStrategy === 'hyde' ? 'HyDE' : 'raw question'}
            </span>
          </p>
          <div className="space-y-2">
            {response.results.map((result) => (
              <div
                key={result.chunk_id}
                className={`rounded-md border p-3 ${
                  synthesis?.cited_chunk_ids.includes(result.chunk_id)
                    ? 'border-indigo-300 bg-indigo-50/50'
                    : 'border-stone-200'
                }`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  {synthesis?.cited_chunk_ids.includes(result.chunk_id) && (
                    <span className="rounded-full bg-indigo-600 px-2 py-0.5 font-medium text-white">cited</span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 font-medium ${SOURCE_STYLES[result.source]}`}>
                    {result.source}
                  </span>
                  {result.similarity != null && (
                    <span className="rounded-full bg-stone-200 px-2 py-0.5 font-medium text-stone-700">
                      {result.similarity.toFixed(3)}
                    </span>
                  )}
                  <span>chunk #{result.chunk_index}</span>
                  <span>{new Date(result.entry_created_at).toLocaleDateString()}</span>
                  <span className="truncate text-stone-400">entry {result.entry_id}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-stone-800">{result.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const RESOLVED_BY_STYLES: Record<'keyword' | 'llm', string> = {
  keyword: 'bg-stone-200 text-stone-700',
  llm: 'bg-violet-100 text-violet-700',
}

function ExtractedFiltersPanel({ extraction }: { extraction: QueryExtractionResult }) {
  const hasAnything =
    extraction.emotion.value.length > 0 || extraction.topics.value.length > 0 || extraction.entities.value.length > 0

  if (!hasAnything) {
    return (
      <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-500">
        Auto-extraction found no emotion, topics, or entities in this question.
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 px-4 py-3">
      <p className="mb-2 text-xs font-medium text-stone-600">Auto-extracted filters</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {extraction.emotion.value.map((emotion) => (
          <span
            key={`emotion-${emotion}`}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESOLVED_BY_STYLES[extraction.emotion.resolvedBy]}`}
            title={`resolved via ${extraction.emotion.resolvedBy}`}
          >
            emotion: {emotion} · {extraction.emotion.resolvedBy}
          </span>
        ))}
        {extraction.topics.value.map((topic) => (
          <span
            key={`topic-${topic}`}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESOLVED_BY_STYLES[extraction.topics.resolvedBy]}`}
            title={`resolved via ${extraction.topics.resolvedBy}`}
          >
            topic: {topic} · {extraction.topics.resolvedBy}
          </span>
        ))}
        {extraction.entities.value.map((entity) => (
          <span
            key={`entity-${entity}`}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESOLVED_BY_STYLES[extraction.entities.resolvedBy]}`}
            title={`resolved via ${extraction.entities.resolvedBy}`}
          >
            entity: {entity} · {extraction.entities.resolvedBy}
          </span>
        ))}
      </div>
    </div>
  )
}
