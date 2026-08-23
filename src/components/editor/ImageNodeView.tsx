import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { IMAGE_BUCKET } from '../../data/attachments'
import { useDecryptedAttachmentUrl } from '../../hooks/useDecryptedAttachmentUrl'

export default function ImageNodeView({ node }: NodeViewProps) {
  const { status, localBlobUrl, storagePath, filename, mimeType } = node.attrs
  const { url: decryptedUrl, failed: resolveFailed } = useDecryptedAttachmentUrl(
    status === 'ready' ? storagePath : null,
    IMAGE_BUCKET,
    mimeType,
  )

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

  const src = status === 'uploading' ? localBlobUrl : decryptedUrl

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
