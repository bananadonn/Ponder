import { useEffect, useState } from 'react'
import { getDecryptedAttachmentUrl } from '../data/attachments'

// Resolves a storage_path to a decrypted, directly-renderable blob: URL.
// Mirrors the inline getSignedUrlCached pattern this replaces in
// GalleryPanel/AudioNodeView/ImageNodeView -- attachment file bytes are
// encrypted at rest, so a signed URL alone can no longer be used as an
// <img>/<audio> src directly.
export function useDecryptedAttachmentUrl(
  storagePath: string | null | undefined,
  bucket: string,
  mimeType: string | null | undefined,
) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!storagePath || !mimeType) return
    let cancelled = false
    getDecryptedAttachmentUrl(storagePath, bucket, mimeType)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [storagePath, bucket, mimeType])

  return { url, failed }
}
