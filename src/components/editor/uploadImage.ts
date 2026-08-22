import type { Editor } from '@tiptap/core'
import { uploadAttachment } from '../../data/attachments'

// Inserts an "uploading" placeholder (local blob preview) at the current
// selection immediately, then swaps it for the real attachment once the
// upload resolves -- identified by tempId, not position, so it stays
// correct even if the user keeps typing elsewhere while the upload is in
// flight.
export async function insertImageAtSelection(editor: Editor, file: File, entryId: string): Promise<void> {
  const tempId = crypto.randomUUID()
  const localBlobUrl = URL.createObjectURL(file)

  editor
    .chain()
    .focus()
    .insertEntryImage({ tempId, filename: file.name, status: 'uploading', localBlobUrl })
    .run()

  try {
    const attachment = await uploadAttachment(entryId, file)
    editor.commands.updateEntryImage(tempId, {
      status: 'ready',
      attachmentId: attachment.id,
      storagePath: attachment.storage_path,
    })
    URL.revokeObjectURL(localBlobUrl)
  } catch (err) {
    editor.commands.updateEntryImage(tempId, { status: 'error' })
    throw err
  }
}
