import type { Entry } from '../data/types'

function preview(content: string, maxLength = 120): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}…` : oneLine
}

export default function EntryListItem({
  entry,
  active = false,
  onSelect,
}: {
  entry: Entry
  active?: boolean
  onSelect: (id: string) => void
}) {
  const date = new Date(entry.created_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <button
      onClick={() => onSelect(entry.id)}
      aria-current={active}
      className={`block w-full rounded-soft px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-mist-200/70' : 'hover:bg-mist-100'
      }`}
    >
      <p className="mb-0.5 text-xs font-medium text-mist-500">{date}</p>
      <p className="truncate text-sm text-mist-800">{preview(entry.content) || 'Empty entry'}</p>
    </button>
  )
}
