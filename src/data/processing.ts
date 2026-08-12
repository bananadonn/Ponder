import { supabase } from '../lib/supabase'

export async function reprocessEntry(entryId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('process-entry', {
    body: { record: { id: entryId } },
  })
  if (error) throw error
}
