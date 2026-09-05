export const EMBEDDING_MODEL = 'text-embedding-3-small'

// Dedicated ASR model, not a chat/completion model -- the cheapest OpenAI
// transcription option and effectively deterministic for a given
// recording, which matters here since nothing downstream should have to
// account for transcript wording drifting between runs.
export const TRANSCRIPTION_MODEL = 'whisper-1'

// USD per token (chat/embedding) or per second (transcription), from
// OpenAI's published pricing -- kept next to the fetch helpers that hit
// each model so a model swap and its price update land in the same place.
// Approximate: real invoices may round differently, but this is precise
// enough to gate the daily spend cap in _shared/usage.ts.
const CHAT_PRICING_PER_TOKEN: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o-mini': { prompt: 0.15e-6, completion: 0.6e-6 },
}
const EMBEDDING_PRICING_PER_TOKEN: Record<string, number> = {
  [EMBEDDING_MODEL]: 0.02e-6,
}
const TRANSCRIPTION_PRICE_PER_SECOND = 0.006 / 60 // whisper-1: $0.006/minute

/**
 * Shared by process-entry (embedding chunks) and search-chunks (embedding a
 * query) so both always use the exact same model — cosine similarity is
 * only meaningful if the vectors being compared came from the same model.
 */
export async function embedTexts(texts: string[], apiKey: string): Promise<{ vectors: number[][]; costUsd: number }> {
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
  const vectors = texts.map((_, i) => byIndex.get(i)!)
  const totalTokens: number | undefined = json.usage?.total_tokens
  const costUsd = totalTokens ? totalTokens * EMBEDDING_PRICING_PER_TOKEN[EMBEDDING_MODEL] : 0
  return { vectors, costUsd }
}

// temperature: 0 keeps output as stable as an ASR model gets across repeat
// runs of the same audio -- no sampling-driven wording drift to worry about
// downstream. Raw text only: no punctuation/cleanup pass, no summarization
// -- whatever Whisper returns is inserted verbatim as the transcript.
// verbose_json (rather than plain text) is what surfaces audio duration,
// which is how Whisper is actually billed (per minute, not per token).
export async function transcribeAudio(audio: Blob, filename: string, apiKey: string): Promise<{ text: string; costUsd: number }> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', TRANSCRIPTION_MODEL)
  form.append('temperature', '0')
  form.append('response_format', 'verbose_json')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    throw new Error(`OpenAI transcription request failed: ${response.status} ${await response.text()}`)
  }

  const json = await response.json()
  const durationSeconds = typeof json.duration === 'number' ? json.duration : 0
  return { text: (json.text as string).trim(), costUsd: durationSeconds * TRANSCRIPTION_PRICE_PER_SECOND }
}

// Shared by every function that calls chat/completions (process-entry,
// reflect, synthesize-answer, hyde.ts, queryExtraction.ts) so the fetch +
// error handling isn't reimplemented per file, and cost estimation always
// reads from the one pricing table above. `label` only changes the thrown
// error's prefix, to keep each call site's error distinguishable in logs.
export async function chatCompletion(
  body: Record<string, unknown>,
  apiKey: string,
  label = 'chat completion',
): Promise<{ json: any; costUsd: number }> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`OpenAI ${label} request failed: ${response.status} ${await response.text()}`)
  }

  const json = await response.json()
  const pricing = CHAT_PRICING_PER_TOKEN[body.model as string]
  const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const costUsd = pricing && usage ? (usage.prompt_tokens ?? 0) * pricing.prompt + (usage.completion_tokens ?? 0) * pricing.completion : 0
  return { json, costUsd }
}
