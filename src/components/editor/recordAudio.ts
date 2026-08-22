import type { Editor } from '@tiptap/core'
import { uploadAudioAttachment } from '../../data/attachments'

// Thin wrapper around MediaRecorder -- start() requests the mic and begins
// recording, stop() ends it and resolves with the captured Blob plus a
// wall-clock duration (good enough for a voice note; not derived from audio
// metadata parsing, which would be unnecessary work here).
export class AudioRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private stream: MediaStream | null = null
  private startedAt = 0

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.startedAt = Date.now()
    this.recorder.start()
  }

  stop(): Promise<{ blob: Blob; durationSeconds: number }> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder
      if (!recorder) {
        reject(new Error('Recording was not started'))
        return
      }
      recorder.onstop = () => {
        const durationSeconds = (Date.now() - this.startedAt) / 1000
        const blob = new Blob(this.chunks, { type: recorder.mimeType })
        this.stream?.getTracks().forEach((track) => track.stop())
        this.stream = null
        this.recorder = null
        resolve({ blob, durationSeconds })
      }
      recorder.stop()
    })
  }

  cancel(): void {
    this.recorder?.stop()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.recorder = null
    this.chunks = []
  }
}

// Inserts an "uploading" placeholder immediately, then swaps it for the
// real attachment once the upload resolves -- identified by tempId, not
// position, matching insertImageAtSelection's approach exactly.
export async function insertAudioAtSelection(
  editor: Editor,
  blob: Blob,
  durationSeconds: number,
  entryId: string,
): Promise<void> {
  const tempId = crypto.randomUUID()
  const localBlobUrl = URL.createObjectURL(blob)

  editor
    .chain()
    .focus()
    .insertEntryAudio({ tempId, filename: 'voice note', status: 'uploading', localBlobUrl, durationSeconds })
    .run()

  try {
    const attachment = await uploadAudioAttachment(entryId, blob, durationSeconds)
    editor.commands.updateEntryAudio(tempId, {
      status: 'ready',
      attachmentId: attachment.id,
      storagePath: attachment.storage_path,
    })
    URL.revokeObjectURL(localBlobUrl)
  } catch (err) {
    editor.commands.updateEntryAudio(tempId, { status: 'error' })
    throw err
  }
}
