import { supabase } from '../lib/supabase'
import type { HybridResult, SynthesisResult } from './types'

export async function synthesizeAnswer(
  question: string,
  matched: boolean,
  results: HybridResult[],
): Promise<SynthesisResult> {
  const { data, error } = await supabase.functions.invoke('synthesize-answer', {
    body: { question, matched, results },
  })
  if (error) throw error
  return data
}
