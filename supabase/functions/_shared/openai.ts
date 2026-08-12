export const EMBEDDING_MODEL = 'text-embedding-3-small'

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
