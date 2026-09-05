import { FormEvent, useEffect, useRef, useState } from 'react'
import PonderMark from './PonderMark'
import type { ReflectCitation } from '../data/types'

export interface ReflectMessage {
  role: 'user' | 'assistant'
  content: string
  citations?: ReflectCitation[]
}

const CITATION_PATTERN = /\[(\d+)\]/g

function renderContent(
  content: string,
  citations: ReflectCitation[] | undefined,
  onOpenEntry: (entryId: string) => void,
): React.ReactNode[] {
  const byIndex = new Map((citations ?? []).map((c) => [c.index, c]))
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  CITATION_PATTERN.lastIndex = 0
  while ((match = CITATION_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index))
    const n = Number(match[1])
    const citation = byIndex.get(n)
    if (citation) {
      parts.push(
        <button
          key={`cite-${key++}`}
          type="button"
          onClick={() => onOpenEntry(citation.entry_id)}
          aria-label={`Open cited entry ${n}`}
          className="mx-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-mist-200 px-1 align-super text-[10px] font-medium text-mist-700 transition-colors hover:bg-mist-300"
        >
          {n}
        </button>,
      )
    } else {
      parts.push(match[0])
    }
    lastIndex = CITATION_PATTERN.lastIndex
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex))
  return parts
}

export default function ReflectionChat({
  messages,
  loading,
  error,
  onSend,
  onOpenEntry,
  onNewReflection,
}: {
  messages: ReflectMessage[]
  loading: boolean
  error: string | null
  onSend: (message: string) => void
  onOpenEntry: (entryId: string) => void
  onNewReflection: () => void
}) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, loading])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSend(trimmed)
    setInput('')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-mist-200 px-3 py-1.5">
        <span className="text-xs text-mist-400">
          {messages.length > 0 ? `${Math.ceil(messages.length / 2)} exchange${messages.length > 2 ? 's' : ''}` : 'A new reflection'}
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onNewReflection}
            className="text-xs font-medium text-mist-500 transition-colors hover:text-mist-900"
          >
            New reflection
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <PonderMark className="h-7 w-auto text-mist-200" />
            <p className="text-sm text-mist-500">
              Ask about your past. Answers are grounded only in your own entries, with citations you can open.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, i) => (
              <div key={i} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-soft px-3 py-2 text-sm leading-relaxed ${
                    message.role === 'user' ? 'bg-mist-900 text-white' : 'border border-mist-200 bg-white text-mist-800'
                  }`}
                >
                  {message.role === 'assistant'
                    ? renderContent(message.content, message.citations, onOpenEntry)
                    : message.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-soft border border-mist-200 bg-white px-3 py-2 text-sm text-mist-400">
                  Reflecting…
                </div>
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-mist-200 p-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me anything…"
          disabled={loading}
          className="w-full rounded-soft border border-mist-200 bg-white px-3 py-2 text-sm text-mist-900 placeholder:text-mist-400 focus:border-mist-500 focus:outline-none focus:ring-2 focus:ring-mist-200 disabled:opacity-60"
        />
      </form>
    </div>
  )
}
