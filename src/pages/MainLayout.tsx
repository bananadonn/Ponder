import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import SearchBar from '../components/SearchBar'
import EntryListItem from '../components/EntryListItem'
import { useAuth } from '../hooks/useAuth'
import { useEntries } from '../hooks/useEntries'

function CompassIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m14.5 9.5-1.8 4.2a1 1 0 0 1-.52.52L8 16l1.8-4.2a1 1 0 0 1 .52-.52L14.5 9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export type ComposerContext = {
  refresh: () => void
  onSaved: (id: string) => void
  showList: () => void
}

export default function MainLayout() {
  const { user } = useAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(searchInput), 250)
    return () => clearTimeout(timeout)
  }, [searchInput])

  const { entries, loading, error, refresh } = useEntries(query)

  // On mobile only one pane shows at a time. Land on the composer straight
  // away for a brand-new journal (nothing to browse yet); otherwise land on
  // the list so a returning visitor sees their entries first.
  const [mobileView, setMobileView] = useState<'list' | 'composer'>('list')
  useEffect(() => {
    if (!loading && entries.length === 0 && !id) setMobileView('composer')
  }, [loading, entries.length, id])

  function openEntry(entryId: string) {
    navigate(`/entries/${entryId}`)
    setMobileView('composer')
  }

  function openNewEntry() {
    navigate('/')
    setMobileView('composer')
  }

  function onSaved(newId: string) {
    navigate(`/entries/${newId}`, { replace: true })
    refresh()
  }

  const context: ComposerContext = { refresh, onSaved, showList: () => setMobileView('list') }

  return (
    <div className="flex h-screen flex-col bg-mist-50">
      <Header email={user?.email} />

      <div className="flex min-h-0 flex-1">
        <div
          className={`${
            mobileView === 'list' ? 'flex' : 'hidden'
          } w-full shrink-0 flex-col border-r border-mist-200 bg-mist-50 md:flex md:w-[340px]`}
        >
          <div className="flex items-center gap-2 border-b border-mist-200 px-4 py-3">
            <SearchBar value={searchInput} onChange={setSearchInput} />
            <button
              onClick={openNewEntry}
              aria-label="New entry"
              title="New entry"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-soft bg-mist-900 text-white transition-colors hover:bg-mist-700"
            >
              <PlusIcon />
            </button>
          </div>

          <Link
            to="/debug/search"
            className="flex items-center gap-2 border-b border-mist-200 px-4 py-3 text-sm font-medium text-mist-700 transition-colors hover:bg-mist-100 hover:text-mist-900"
          >
            <CompassIcon />
            Reflect
          </Link>

          <div className="flex-1 overflow-y-auto px-2.5 py-2.5">
            {loading && <p className="px-1.5 py-2 text-sm text-mist-500">Loading…</p>}
            {error && <p className="px-1.5 py-2 text-sm text-red-600">{error}</p>}

            {!loading && !error && entries.length === 0 && (
              <p className="px-1.5 py-2 text-sm text-mist-500">
                {query ? 'No entries match your search.' : 'Nothing yet — start writing on the right.'}
              </p>
            )}

            <div className="space-y-1.5">
              {entries.map((entry) => (
                <EntryListItem key={entry.id} entry={entry} active={entry.id === id} onSelect={openEntry} />
              ))}
            </div>
          </div>
        </div>

        <div className={`${mobileView === 'composer' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>
          <Outlet context={context} />
        </div>
      </div>
    </div>
  )
}
