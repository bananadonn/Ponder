/**
 * Splits entry content into paragraph-sized chunks. A short entry with no
 * blank-line breaks naturally falls through as a single chunk — no
 * separate short-entry special case needed.
 */
export function chunkContent(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}
