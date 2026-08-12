// Mirrors EMOTION_LABELS in supabase/functions/_shared/emotionLabels.ts.
// Duplicated rather than fetched at runtime — it's a fixed vocabulary, not
// data, and pulling it from the server would just be a round trip for a
// constant that changes about as often as the extraction prompt does.
export const EMOTION_LABELS = [
  'joy', 'sadness', 'anger', 'fear', 'anxiety', 'calm', 'gratitude',
  'frustration', 'love', 'shame', 'guilt', 'pride', 'surprise', 'disgust', 'neutral',
] as const
