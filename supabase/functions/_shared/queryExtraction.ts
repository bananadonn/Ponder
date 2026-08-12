import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { EMOTION_LABELS, type EmotionLabel } from './emotionLabels.ts'
import { matchEmotionKeyword } from './emotionSynonyms.ts'
import { listKnownTopics, matchKnownVocab } from './vocabMatch.ts'
import { extractDateFilter, type DateFilter, type DateResolvedBy } from './dateExtraction.ts'

const EXTRACTION_MODEL = 'gpt-4o-mini'

export type ResolvedBy = 'keyword' | 'llm'

export interface ExtractedField<T> {
  value: T
  resolvedBy: ResolvedBy
}

// Wire-serializable form of DateFilter — Date objects become ISO strings
// for the JSON response / query_log insert.
export type SerializedDateFilter = { type: 'range'; start: string; end: string } | { type: 'recurring_month'; month: number }

// Not an ExtractedField<T> like the fields below — date_filter is resolved
// by a different mechanism (see dateExtraction.ts) with its own diagnostic
// shape: resolvedBy is 'calendar-unit' | 'chrono' | null (no keyword/LLM
// choice), plus which calendar-unit pattern(s) matched, kept for the
// query_log spot-checks called for in dateExtraction.ts's docs.
export interface DateFilterField {
  value: SerializedDateFilter | null
  resolvedBy: DateResolvedBy | null
  matchedPattern: string | null
  allMatchedPatterns: string[]
}

export interface QueryExtractionResult {
  emotion: ExtractedField<EmotionLabel | null>
  topics: ExtractedField<string[]>
  entities: ExtractedField<string[]>
  date_filter: DateFilterField
}

interface LlmExtractionResult {
  emotion?: EmotionLabel | null
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
      type: ['string', 'null'],
      enum: [...EMOTION_LABELS, null],
      description: 'The single emotion this question implies, or null if none clearly apply.',
    }
    required.push('emotion')
    instructions.push(
      `- emotion: does the question imply one of these specific emotions — ${EMOTION_LABELS.join(', ')}? Return that exact value if so, or null if there is no clear match. Never force a mapping.`,
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
  if (need.entities) {
    properties.entities = {
      type: 'array',
      items: { type: 'string' },
      description: 'Proper nouns (people, places, organizations) explicitly named in the question. Empty array if none.',
    }
    required.push('entities')
    instructions.push(
      '- entities: proper nouns (people, places, organizations) explicitly named in the question. Empty array if none.',
    )
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

function serializeDateFilter(filter: DateFilter | null): SerializedDateFilter | null {
  if (!filter) return null
  if (filter.type === 'recurring_month') return filter
  return { type: 'range', start: filter.start.toISOString(), end: filter.end.toISOString() }
}

/**
 * Query extraction ("Prompt B"): infers structured filters (emotion, topics,
 * entities, date_filter) from a natural-language question, so the
 * structured side of hybrid search doesn't require the user to hand-pick
 * filters. Each field resolves independently — Layer 1 (keyword/synonym
 * match for emotion, fuzzy known-vocab match for topics/entities) runs
 * first with no LLM call; Layer 2 (LLM, constrained to the closed emotion
 * vocabulary and the user's own existing topic vocabulary — never open
 * generation) only runs for whichever fields Layer 1 left unresolved, in a
 * single call. date_filter resolves via neither layer — see
 * dateExtraction.ts for its calendar-unit-pattern-then-chrono-fallback
 * approach.
 *
 * `referenceDate` anchors date_filter's relative expressions ("yesterday",
 * "this month") — defaults to the real current time, overridable for tests.
 */
export async function extractQueryFilters(
  client: SupabaseClient,
  question: string,
  apiKey: string,
  referenceDate: Date = new Date(),
): Promise<QueryExtractionResult> {
  const keywordEmotion = matchEmotionKeyword(question)

  // Independent of both layers below, and of everything an LLM does — a
  // failure here must not take emotion/topics/entities resolution down with
  // it, same reasoning as the vocab-match try/catch just below.
  let dateFilter: DateFilterField = { value: null, resolvedBy: null, matchedPattern: null, allMatchedPatterns: [] }
  try {
    const result = extractDateFilter(question, referenceDate)
    dateFilter = {
      value: serializeDateFilter(result.filter),
      resolvedBy: result.resolvedBy,
      matchedPattern: result.matchedPattern,
      allMatchedPatterns: result.allMatchedPatterns,
    }
  } catch (err) {
    console.error('extractDateFilter failed; leaving date_filter unresolved', err)
  }

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
    emotion: keywordEmotion === null,
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
      keywordEmotion !== null
        ? { value: keywordEmotion, resolvedBy: 'keyword' }
        : { value: llmResult.emotion ?? null, resolvedBy: 'llm' },
    topics:
      vocabMatches.topics.length > 0
        ? { value: vocabMatches.topics, resolvedBy: 'keyword' }
        : { value: llmResult.topics ?? [], resolvedBy: 'llm' },
    entities:
      vocabMatches.entities.length > 0
        ? { value: vocabMatches.entities, resolvedBy: 'keyword' }
        : { value: llmResult.entities ?? [], resolvedBy: 'llm' },
    date_filter: dateFilter,
  }
}
