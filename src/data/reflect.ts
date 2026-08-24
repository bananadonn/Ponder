import { supabase } from '../lib/supabase'
import { describeFunctionError } from '../lib/functionError'
import type { HistoryTurn, HybridFilters, ReflectResponse } from './types'

export async function reflectChat(
  message: string,
  history: HistoryTurn[],
  filters?: HybridFilters,
): Promise<ReflectResponse> {
  const { data, error } = await supabase.functions.invoke('reflect', {
    body: { message, history, filters },
  })
  if (error) throw new Error(`reflect failed: ${await describeFunctionError(error)}`)
  return data
}
