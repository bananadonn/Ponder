import { useEffect, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { getSignedUrlCached } from '../../data/attachments'

export default function ImageNodeView({ node }: NodeViewProps) {
  const { status, localBlobUrl, storagePath, filename } = node.attrs
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [resolveFailed, setResolveFailed] = useState(false)

  useEffect(() => {
    if (status !== 'ready' || !storagePath) return
    let cancelled = false
    getSignedUrlCached(storagePath)
      .then((url) => {
        if (!cancelled) setSignedUrl(url)
      })
      .catch(() => {
        if (!cancelled) setResolveFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [status, storagePath])

  if (status === 'error' || resolveFailed) {
    return (
      <NodeViewWrapper
        as="span"
        className="inline-flex items-center gap-1 rounded-soft border border-red-200 bg-red-50 px-2 py-1 align-middle text-xs text-red-700"
      >
        Couldn't load {filename}
      </NodeViewWrapper>
    )
  }

  const src = status === 'uploading' ? localBlobUrl : signedUrl

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle">
      {src ? (
        <img
          src={src}
          alt={filename}
          className={`my-1 block max-h-80 rounded-soft border border-mist-200 ${
            status === 'uploading' ? 'opacity-60' : ''
          }`}
        />
      ) : (
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-soft border border-mist-200 bg-mist-100 text-xs text-mist-400">
          …
        </span>
      )}
    </NodeViewWrapper>
  )
}
