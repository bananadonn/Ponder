import { useEffect, useRef, useState } from 'react'
import EntryListItem from './EntryListItem'
import PonderMark from './PonderMark'
import TagPicker from './TagPicker'
import { useEntries } from '../hooks/useEntries'
import { EMOTION_LABELS } from '../data/emotions'
import { listKnownEntities, listKnownTopics } from '../data/vocab'
import type { HybridFilters } from '../data/types'

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function GalleryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="9.5" r="1.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="m5 17 4.5-5 3.5 3.5 2-2L21 18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
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

export default function RackPanel({
  activeEntryId,
  onSelectEntry,
  onNewEntry,
  onOpenGallery,
  refreshSignal,
  onFiltersChange,
}: {
  activeEntryId?: string
  onSelectEntry: (id: string) => void
  onNewEntry: () => void
  // Swaps the Journal panel over to a scrollable grid of every photo
  // attached across the whole journal, not just the active entry.
  onOpenGallery?: () => void
  // Incremented by the caller after a save/delete elsewhere in the app, to
  // re-fetch this panel's (possibly filtered) list without resetting its
  // filter UI state the way a remount would.
  refreshSignal?: number
  // Reports the resolved filter set upward whenever it changes, so Search &
  // Reflect's Retrieval mode can constrain its own search by the same
  // filters. The Rack still owns the raw UI state (chips, dates) itself —
  // only the resolved HybridFilters shape is shared.
  onFiltersChange?: (filters: HybridFilters) => void
}) {
  const [showFilters, setShowFilters] = useState(false)
  const [emotions, setEmotions] = useState<string[]>([])
  const [entities, setEntities] = useState<string[]>([])
  const [topics, setTopics] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [knownTopics, setKnownTopics] = useState<string[]>([])
  const [knownEntities, setKnownEntities] = useState<string[]>([])

  const filters: HybridFilters = {
    emotions: emotions.length > 0 ? emotions : undefined,
    entities: entities.length > 0 ? entities : undefined,
    topics: topics.length > 0 ? topics : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  }
  const activeFilterCount = emotions.length + entities.length + topics.length + (startDate ? 1 : 0) + (endDate ? 1 : 0)

  const { entries, loading, error, refresh } = useEntries(filters)

  useEffect(() => {
    onFiltersChange?.(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)])

  function refreshVocab() {
    listKnownTopics().then(setKnownTopics).catch(() => {})
    listKnownEntities().then(setKnownEntities).catch(() => {})
  }

  // Initial load.
  useEffect(refreshVocab, [])

  const skipFirstRefresh = useRef(true)
  useEffect(() => {
    if (skipFirstRefresh.current) {
      skipFirstRefresh.current = false
      return
    }
    refresh()
    // New entries can introduce new topics/entities once reprocessed.
    refreshVocab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  function toggleEmotion(emotion: string) {
    setEmotions((prev) => (prev.includes(emotion) ? prev.filter((e) => e !== emotion) : [...prev, emotion]))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mist-200 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          className="flex flex-1 items-center gap-1 text-xs font-medium text-mist-500 transition-colors hover:text-mist-900"
        >
          Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
          <ChevronIcon open={showFilters} />
        </button>
        {onOpenGallery && (
          <button
            onClick={onOpenGallery}
            aria-label="Gallery"
            title="Gallery"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-soft text-mist-500 transition-colors hover:bg-mist-100 hover:text-mist-900"
          >
            <GalleryIcon />
          </button>
        )}
        <button
          onClick={onNewEntry}
          aria-label="New entry"
          title="New entry"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-soft bg-mist-900 text-white transition-colors hover:bg-mist-700"
        >
          <PlusIcon />
        </button>
      </div>

      {showFilters && (
        <div className="space-y-3 border-b border-mist-200 bg-mist-50 p-3">
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
          <TagPicker placeholder="Topics" options={knownTopics} selected={topics} onChange={setTopics} />
          <TagPicker
            placeholder="People or places"
            options={knownEntities}
            selected={entities}
            onChange={setEntities}
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-soft border border-mist-200 bg-white px-2.5 py-1.5 text-sm text-mist-800 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
            />
            <span className="text-xs text-mist-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-soft border border-mist-200 bg-white px-2.5 py-1.5 text-sm text-mist-800 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5">
        {loading && <p className="px-1.5 py-2 text-sm text-mist-500">Loading…</p>}
        {error && <p className="px-1.5 py-2 text-sm text-red-600">{error}</p>}

        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            {activeFilterCount === 0 && <PonderMark className="h-7 w-auto text-mist-200" />}
            <p className="text-sm text-mist-500">
              {activeFilterCount > 0 ? 'No entries match these filters.' : 'Nothing yet — start writing on the right.'}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          {entries.map((entry) => (
            <EntryListItem key={entry.id} entry={entry} active={entry.id === activeEntryId} onSelect={onSelectEntry} />
          ))}
        </div>
      </div>
    </div>
  )
}
