import { Link } from 'react-router-dom'
import type { Entry } from '../data/types'

function preview(content: string, maxLength = 160): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}…` : oneLine
}

export default function EntryListItem({ entry }: { entry: Entry }) {
  const date = new Date(entry.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Link
      to={`/entries/${entry.id}`}
      className="block rounded-md border border-stone-200 px-4 py-3 hover:border-stone-400"
    >
      <p className="mb-1 text-xs font-medium text-stone-500">{date}</p>
      <p className="text-sm text-stone-800">{preview(entry.content) || 'Empty entry'}</p>
    </Link>
  )
}
