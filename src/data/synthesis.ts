import { supabase } from '../lib/supabase'
import { describeFunctionError } from '../lib/functionError'
import type { HybridResult, SynthesisResult } from './types'

export async function synthesizeAnswer(
  question: string,
  matched: boolean,
  results: HybridResult[],
): Promise<SynthesisResult> {
  const { data, error } = await supabase.functions.invoke('synthesize-answer', {
    body: { question, matched, results },
  })
  if (error) throw new Error(`synthesize-answer failed: ${await describeFunctionError(error)}`)
  return data
}
