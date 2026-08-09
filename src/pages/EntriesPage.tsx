import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import SearchBar from '../components/SearchBar'
import EntryListItem from '../components/EntryListItem'
import { useAuth } from '../hooks/useAuth'
import { useEntries } from '../hooks/useEntries'

export default function EntriesPage() {
  const { user } = useAuth()
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => setQuery(searchInput), 250)
    return () => clearTimeout(timeout)
  }, [searchInput])

  const { entries, loading, error } = useEntries(query)

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <Header email={user?.email} />

      <div className="mb-4 flex items-center gap-3">
        <SearchBar value={searchInput} onChange={setSearchInput} />
        <Link
          to="/entries/new"
          className="shrink-0 rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          New entry
        </Link>
      </div>

      {loading && <p className="text-sm text-stone-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-stone-500">
          {query ? 'No entries match your search.' : 'No entries yet — write your first one.'}
        </p>
      )}

      <div className="space-y-2">
        {entries.map((entry) => (
          <EntryListItem key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
