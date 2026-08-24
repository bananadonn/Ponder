// supabase-js's own error for a non-2xx Edge Function response is always
// the same generic "Edge Function returned a non-2xx status code", no
// matter which function or what actually went wrong -- the real reason
// (status code, the function's own JSON error body) is sitting on
// `error.context` (a Response) but never read anywhere. This unwraps it so
// error messages/logs carry the actual cause instead of the generic string.
export async function describeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    let body: string | null = null
    try {
      const cloned = context.clone()
      const json = await cloned.json()
      body = typeof json?.error === 'string' ? json.error : JSON.stringify(json)
    } catch {
      try {
        body = await context.clone().text()
      } catch {
        body = null
      }
    }
    return `HTTP ${context.status}${body ? `: ${body}` : ''}`
  }
  return error instanceof Error ? error.message : 'Unknown error'
}
