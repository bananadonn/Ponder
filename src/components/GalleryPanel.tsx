import { useEffect, useState } from 'react'
import { IMAGE_BUCKET, listImageAttachments } from '../data/attachments'
import { useDecryptedAttachmentUrl } from '../hooks/useDecryptedAttachmentUrl'
import type { Attachment } from '../data/types'

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

function ImageIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5 17 4.5-5 3.5 3.5 2-2L21 18" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function GalleryThumb({ attachment, onOpenEntry }: { attachment: Attachment; onOpenEntry: (id: string) => void }) {
  const { url, failed } = useDecryptedAttachmentUrl(attachment.storage_path, IMAGE_BUCKET, attachment.mime_type)

  return (
    <button
      type="button"
      onClick={() => onOpenEntry(attachment.entry_id)}
      title={attachment.filename}
      className="aspect-square overflow-hidden rounded-soft border border-mist-200 bg-mist-100 transition-opacity hover:opacity-80"
    >
      {failed ? (
        <span className="flex h-full w-full items-center justify-center text-xs text-mist-400">Couldn't load</span>
      ) : url ? (
        <img src={url} alt={attachment.filename} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-mist-400">…</span>
      )}
    </button>
  )
}

export default function GalleryPanel({
  onOpenEntry,
  onClose,
}: {
  onOpenEntry: (id: string) => void
  onClose: () => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listImageAttachments()
      .then(setAttachments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load photos'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-mist-200 px-5 py-2.5 md:px-8">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-sm font-medium text-mist-500 transition-colors hover:text-mist-900"
        >
          <BackIcon />
          Entries
        </button>
        <span className="font-display text-sm font-bold text-mist-900">Gallery</span>
        <span className="w-16" aria-hidden="true" />
      </div>

      <div className="mx-auto w-full max-w-[clamp(42rem,60vw,72rem)] flex-1 px-5 py-6 md:px-8 md:py-10">
        {loading && <p className="text-sm text-mist-500">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && !error && attachments.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-mist-400">
            <ImageIcon />
            <p className="text-sm text-mist-500">No photos yet — attach an image to an entry to see it here.</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
            {attachments.map((attachment) => (
              <GalleryThumb key={attachment.id} attachment={attachment} onOpenEntry={onOpenEntry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
