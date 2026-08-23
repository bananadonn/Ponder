import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { AUDIO_BUCKET } from '../../data/attachments'
import { useDecryptedAttachmentUrl } from '../../hooks/useDecryptedAttachmentUrl'

// Mirrors ImageNodeView -- resolves a decrypted blob URL once the upload
// has landed, shows a lightweight placeholder while uploading. `transcript`
// is present on the node's attrs (see AudioNode.ts) but deliberately never
// rendered here -- it exists purely so docToPlainText can pull it into the
// entry's searchable text; the composer only ever shows a player.
export default function AudioNodeView({ node }: NodeViewProps) {
  const { status, localBlobUrl, storagePath, filename, mimeType } = node.attrs
  const { url: decryptedUrl, failed: resolveFailed } = useDecryptedAttachmentUrl(
    status === 'ready' ? storagePath : null,
    AUDIO_BUCKET,
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
    <NodeViewWrapper as="span" className="my-1 inline-block max-w-full align-middle">
      {src ? (
        <audio
          src={src}
          controls
          className={`h-10 max-w-full align-middle ${status === 'uploading' ? 'opacity-60' : ''}`}
        />
      ) : (
        <span className="inline-flex h-10 w-48 items-center justify-center rounded-soft border border-mist-200 bg-mist-100 text-xs text-mist-400">
          …
        </span>
      )}
    </NodeViewWrapper>
  )
}
