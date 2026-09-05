import { chatCompletion } from './openai.ts'

const HYDE_MODEL = 'gpt-4o-mini'

const HYDE_SYSTEM_PROMPT = `Given this question about someone's journal, write a short (2-4 sentence) hypothetical journal entry, in first person, in a natural diary-writing tone, that would represent a relevant answer.

Do not answer the question directly or add commentary — just write the hypothetical entry text itself.`

/**
 * HyDE (Hypothetical Document Embeddings): journal entries and questions are
 * written in different voice/style, so a raw question often embeds far from
 * the real entries that would actually answer it. This generates a
 * fabricated diary-style entry that a good answer would look like, so *that*
 * gets embedded and compared against real entries instead.
 *
 * The output is fabricated, not real journal content — callers must only use
 * it to drive the vector search leg, never surface it to the user or pass it
 * into synthesis.
 */
export async function generateHypotheticalEntry(question: string, apiKey: string): Promise<{ text: string; costUsd: number }> {
  const { json, costUsd } = await chatCompletion(
    {
      model: HYDE_MODEL,
      messages: [
        { role: 'system', content: HYDE_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
    },
    apiKey,
    'HyDE',
  )

  const text: string | undefined = json.choices?.[0]?.message?.content?.trim()
  if (!text) {
    throw new Error('OpenAI HyDE request returned empty content')
  }
  return { text, costUsd }
}
