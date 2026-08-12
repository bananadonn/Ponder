import { EMOTION_LABELS, type EmotionLabel } from './emotionLabels.ts'

// Layer 1 of query extraction (phase 7): resolves a question's emotion
// without an LLM call whenever it contains a known synonym. Seeded from the
// closed vocabulary itself (identity mappings, so "sadness" always matches)
// plus a reasonable set of common synonyms per label. Expand this over time
// based on how often query_log shows Layer 2 (the LLM) resolving emotion
// instead of this — that's the signal this list is missing something common.
const EMOTION_SYNONYMS: Record<string, EmotionLabel> = {
  ...Object.fromEntries(EMOTION_LABELS.map((label): [EmotionLabel, EmotionLabel] => [label, label])),

  happy: 'joy', happiness: 'joy', glad: 'joy', delighted: 'joy', cheerful: 'joy', excited: 'joy', elated: 'joy',
  sad: 'sadness', down: 'sadness', blue: 'sadness', depressed: 'sadness', unhappy: 'sadness', gloomy: 'sadness', heartbroken: 'sadness', miserable: 'sadness',
  angry: 'anger', mad: 'anger', pissed: 'anger', furious: 'anger', irritated: 'anger', annoyed: 'anger', enraged: 'anger',
  scared: 'fear', afraid: 'fear', frightened: 'fear', terrified: 'fear', fearful: 'fear',
  anxious: 'anxiety', nervous: 'anxiety', worried: 'anxiety', stressed: 'anxiety', overwhelmed: 'anxiety', uneasy: 'anxiety',
  relaxed: 'calm', peaceful: 'calm', serene: 'calm', tranquil: 'calm', chill: 'calm',
  grateful: 'gratitude', thankful: 'gratitude', appreciative: 'gratitude',
  frustrated: 'frustration', exasperated: 'frustration',
  loving: 'love', affection: 'love', adore: 'love', adored: 'love',
  ashamed: 'shame', embarrassed: 'shame', humiliated: 'shame',
  guilty: 'guilt', remorseful: 'guilt', regretful: 'guilt',
  proud: 'pride', accomplished: 'pride',
  surprised: 'surprise', shocked: 'surprise', astonished: 'surprise',
  disgusted: 'disgust', repulsed: 'disgust', gross: 'disgust',
}

// Returns every distinct emotion the question mentions, ordered by where its
// earliest keyword appears in the text — not by EMOTION_SYNONYMS' definition
// order, which has no relationship to the question itself. A question can
// genuinely name more than one real emotion for the same event ("proud but
// anxious"), so this collects all of them rather than forcing a single pick.
export function matchEmotionKeywords(question: string): EmotionLabel[] {
  const normalized = ` ${question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `

  const matches: { label: EmotionLabel; index: number }[] = []
  for (const [keyword, label] of Object.entries(EMOTION_SYNONYMS)) {
    const index = normalized.indexOf(` ${keyword} `)
    if (index !== -1) matches.push({ label, index })
  }
  matches.sort((a, b) => a.index - b.index)

  return [...new Set(matches.map((m) => m.label))]
}
