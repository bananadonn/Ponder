export const EMBEDDING_MODEL = 'text-embedding-3-small'

// Dedicated ASR model, not a chat/completion model -- the cheapest OpenAI
// transcription option and effectively deterministic for a given
// recording, which matters here since nothing downstream should have to
// account for transcript wording drifting between runs.
export const TRANSCRIPTION_MODEL = 'whisper-1'

/**
 * Shared by process-entry (embedding chunks) and search-chunks (embedding a
 * query) so both always use the exact same model — cosine similarity is
 * only meaningful if the vectors being compared came from the same model.
 */
export async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI embeddings request failed: ${response.status} ${await response.text()}`)
  }

  const json = await response.json()
  const byIndex = new Map<number, number[]>(
    json.data.map((d: { index: number; embedding: number[] }) => [d.index, d.embedding]),
  )
  return texts.map((_, i) => byIndex.get(i)!)
}

// temperature: 0 keeps output as stable as an ASR model gets across repeat
// runs of the same audio -- no sampling-driven wording drift to worry about
// downstream. Raw text only: no punctuation/cleanup pass, no summarization
// -- whatever Whisper returns is inserted verbatim as the transcript.
export async function transcribeAudio(audio: Blob, filename: string, apiKey: string): Promise<string> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', TRANSCRIPTION_MODEL)
  form.append('temperature', '0')
  form.append('response_format', 'text')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    throw new Error(`OpenAI transcription request failed: ${response.status} ${await response.text()}`)
  }

  return (await response.text()).trim()
}
