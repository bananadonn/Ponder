import { supabase } from '../lib/supabase'
import { describeFunctionError } from '../lib/functionError'

export async function reprocessEntry(entryId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('process-entry', {
    body: { record: { id: entryId } },
  })
  if (error) throw new Error(`process-entry failed: ${await describeFunctionError(error)}`)
}
