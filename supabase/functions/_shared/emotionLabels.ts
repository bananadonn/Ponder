// Canonical closed emotion vocabulary. Chunk metadata extraction
// (process-entry, phase 2) and query extraction (phase 7) are both
// constrained to this list, so filtering later stays exact instead of
// fragmenting into free-text variants like "angry" vs "anger" vs "mad".
//
// The frontend keeps its own mirror at src/data/emotions.ts — it's a fixed
// vocabulary, not data, so pulling it from the server at runtime would just
// be a round trip for a constant that changes about as often as this file.
export const EMOTION_LABELS = [
  'joy', 'sadness', 'anger', 'fear', 'anxiety', 'calm', 'gratitude',
  'frustration', 'love', 'shame', 'guilt', 'pride', 'surprise', 'disgust', 'neutral',
] as const

export type EmotionLabel = (typeof EMOTION_LABELS)[number]
