import type { Editor } from '@tiptap/core'
import { uploadAudioAttachment } from '../../data/attachments'

// Thin wrapper around MediaRecorder -- start() requests the mic and begins
// recording, stop() ends it and resolves with the captured Blob plus a
// wall-clock duration (good enough for a voice note; not derived from audio
// metadata parsing, which would be unnecessary work here).
//
// Alongside MediaRecorder (which only encodes -- it exposes no way to read
// input level), start() also taps the same mic stream into a Web Audio
// AnalyserNode purely for metering: getLevel() lets the UI poll "is this
// actually picking up sound right now" while recording, independent of
// whether the encoded recording turns out fine. The analyser is never
// connected to audioContext.destination, so none of this plays audio back.
export class AudioRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private stream: MediaStream | null = null
  private startedAt = 0
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private levelData: Uint8Array<ArrayBuffer> | null = null

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.startedAt = Date.now()
    this.recorder.start()

    this.audioContext = new AudioContext()
    await this.audioContext.resume()
    const source = this.audioContext.createMediaStreamSource(this.stream)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 256
    source.connect(this.analyser)
    this.levelData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
  }

  // Instantaneous input level as 0 (silence) to 1 (loud), via RMS deviation
  // from the analyser's midpoint sample value. Meant to be polled on an
  // animation-frame cadence while recording, not stored/logged anywhere --
  // this is UI feedback only, not part of what gets saved.
  getLevel(): number {
    if (!this.analyser || !this.levelData) return 0
    this.analyser.getByteTimeDomainData(this.levelData)
    let sumSquares = 0
    for (const sample of this.levelData) {
      const deviation = (sample - 128) / 128
      sumSquares += deviation * deviation
    }
    const rms = Math.sqrt(sumSquares / this.levelData.length)
    // RMS for typical speech rarely approaches 1 -- scale up so normal
    // talking registers as a clearly visible level, not a barely-there one.
    return Math.min(1, rms * 4)
  }

  private teardownAudioContext(): void {
    this.audioContext?.close()
    this.audioContext = null
    this.analyser = null
    this.levelData = null
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
        this.teardownAudioContext()
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
    this.teardownAudioContext()
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
