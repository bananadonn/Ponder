import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { EMOTION_LABELS, type EmotionLabel } from './emotionLabels.ts'
import { matchEmotionKeywords } from './emotionSynonyms.ts'
import { listKnownEntities, listKnownTopics, matchKnownVocab } from './vocabMatch.ts'

const EXTRACTION_MODEL = 'gpt-4o-mini'

export type ResolvedBy = 'keyword' | 'llm'

export interface ExtractedField<T> {
  value: T
  resolvedBy: ResolvedBy
}

export interface QueryExtractionResult {
  emotion: ExtractedField<EmotionLabel[]>
  topics: ExtractedField<string[]>
  entities: ExtractedField<string[]>
}

interface LlmExtractionResult {
  emotion?: EmotionLabel[]
  topics?: string[]
  entities?: string[]
}

interface FieldsNeeded {
  emotion: boolean
  topics: boolean
  entities: boolean
}

// Layer 2: only asks the LLM for whichever fields Layer 1 left unresolved —
// if Layer 1 resolved everything, this is never called. Fields not needed
// aren't included in the schema at all, rather than asked for and discarded,
// so there's nothing pushing the model toward filling them in anyway.
async function llmExtractFields(
  client: SupabaseClient,
  question: string,
  need: FieldsNeeded,
  apiKey: string,
): Promise<LlmExtractionResult> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const instructions: string[] = []

  if (need.emotion) {
    properties.emotion = {
      type: 'array',
      items: { type: 'string', enum: EMOTION_LABELS },
      description: 'Every emotion from this exact list the question clearly implies. A question can genuinely imply more than one (e.g. "proud but anxious"). Empty array if none clearly apply.',
    }
    required.push('emotion')
    instructions.push(
      `- emotion: does the question imply any of these specific emotions — ${EMOTION_LABELS.join(', ')}? Return every one that clearly applies (a question can name more than one real emotion for the same event), or an empty array if none do. Never force a mapping.`,
    )
  }
  // Topics are constrained to the user's own existing vocabulary rather
  // than freely generated — open generation previously let the model echo
  // the question itself back as a "topic" (e.g. "sad moment" for the
  // question "sad moment"), which then matched zero real chunks. Fetched
  // only when topics are actually needed. If there's no known vocabulary
  // yet (e.g. a brand-new user), there's nothing to choose from, so this
  // field is dropped from the request entirely rather than asking the model
  // to pick from an empty list.
  if (need.topics) {
    const knownTopics = await listKnownTopics(client)
    if (knownTopics.length > 0) {
      properties.topics = {
        type: 'array',
        items: { type: 'string', enum: knownTopics },
        description: 'Topics from the provided list that this question is about. Empty array if none fit.',
      }
      required.push('topics')
      instructions.push(
        `- topics: choose zero or more topics from this exact list that the question is about — do not invent new ones, only pick from what's given: ${knownTopics.join(', ')}. Return an empty array if none clearly fit. Never force a choice.`,
      )
    }
  }
  // Entities had the same open-generation risk topics was fixed for above —
  // constrained to the user's own existing vocabulary for the same reason.
  // If there's no known vocabulary yet, dropped from the request entirely,
  // same as topics.
  if (need.entities) {
    const knownEntities = await listKnownEntities(client)
    if (knownEntities.length > 0) {
      properties.entities = {
        type: 'array',
        items: { type: 'string', enum: knownEntities },
        description: 'Entities from the provided list that this question is about. Empty array if none fit.',
      }
      required.push('entities')
      instructions.push(
        `- entities: choose zero or more proper nouns (people, places, organizations) from this exact list that the question is about — do not invent new ones, only pick from what's given: ${knownEntities.join(', ')}. Return an empty array if none clearly fit. Never force a choice.`,
      )
    }
  }

  // Nothing left to ask for — e.g. topics was the only requested field and
  // there's no known-topic vocabulary yet to choose from. Skip the call.
  if (Object.keys(properties).length === 0) {
    return {}
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      messages: [
        {
          role: 'system',
          content: `You extract structured search filters from a natural-language question about someone's personal journal.\n\n${instructions.join('\n')}\n\nBase everything strictly on what the question actually implies — never force a mapping.`,
        },
        { role: 'user', content: question },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'query_filters',
          strict: true,
          schema: { type: 'object', properties, required, additionalProperties: false },
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI query extraction request failed: ${response.status} ${await response.text()}`)
  }

  const json = await response.json()
  return JSON.parse(json.choices[0].message.content)
}

/**
 * Query extraction ("Prompt B"): infers structured filters (emotion, topics,
 * entities) from a natural-language question, so the structured side of
 * hybrid search doesn't require the user to hand-pick filters. Each field
 * resolves independently — Layer 1 (keyword/synonym match for emotion,
 * fuzzy known-vocab match for topics/entities) runs first with no LLM call;
 * Layer 2 (LLM, constrained to the closed emotion vocabulary and the user's
 * own existing topic/entity vocabulary — never open generation) only runs
 * for whichever fields Layer 1 left unresolved, in a single call.
 *
 * emotion is an array, not a single value: a question can genuinely name
 * more than one real emotion for the same event ("proud but anxious"), and
 * forcing a single pick would silently drop whichever one lost. Layer 1
 * collects every distinct emotion whose keyword appears in the question,
 * ordered by earliest occurrence in the text (not by definition order in
 * EMOTION_SYNONYMS, which has no relationship to the question itself).
 *
 * Deliberately no date field: "august" or "may" can be a month or a name,
 * and "yesterday" can be a date constraint or the actual topic of the
 * question ("times I reflected on yesterday") — that ambiguity isn't a
 * parsing bug to fix, it's inherent to the language. Date filtering is
 * handled entirely by an explicit UI control instead (see hybrid-search's
 * request body / Filters.startDate-endDate), never inferred from question
 * text.
 */
export async function extractQueryFilters(
  client: SupabaseClient,
  question: string,
  apiKey: string,
): Promise<QueryExtractionResult> {
  const keywordEmotions = matchEmotionKeywords(question)

  // A failure here must not take emotion's keyword match down with it — each
  // field resolves independently, so this degrades to "nothing matched"
  // (falls through to Layer 2 for topics/entities) rather than failing the
  // whole extraction.
  let vocabMatches: { topics: string[]; entities: string[] }
  try {
    vocabMatches = await matchKnownVocab(client, question)
  } catch (err) {
    console.error('match_known_vocab failed; falling back to Layer 2 for topics/entities', err)
    vocabMatches = { topics: [], entities: [] }
  }

  const need: FieldsNeeded = {
    emotion: keywordEmotions.length === 0,
    topics: vocabMatches.topics.length === 0,
    entities: vocabMatches.entities.length === 0,
  }

  // Same reasoning: an LLM failure degrades whatever fields it was asked
  // for to unresolved, rather than discarding fields Layer 1 already
  // resolved (e.g. a topics/entities LLM error shouldn't erase a
  // successful keyword match on emotion).
  let llmResult: LlmExtractionResult = {}
  if (need.emotion || need.topics || need.entities) {
    try {
      llmResult = await llmExtractFields(client, question, need, apiKey)
    } catch (err) {
      console.error('LLM query-extraction fallback failed; leaving requested fields unresolved', err)
    }
  }

  return {
    emotion:
      keywordEmotions.length > 0
        ? { value: keywordEmotions, resolvedBy: 'keyword' }
        : { value: llmResult.emotion ?? [], resolvedBy: 'llm' },
    topics:
      vocabMatches.topics.length > 0
        ? { value: vocabMatches.topics, resolvedBy: 'keyword' }
        : { value: llmResult.topics ?? [], resolvedBy: 'llm' },
    entities:
      vocabMatches.entities.length > 0
        ? { value: vocabMatches.entities, resolvedBy: 'keyword' }
        : { value: llmResult.entities ?? [], resolvedBy: 'llm' },
  }
}
