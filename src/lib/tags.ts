// #topic and @entity tags the user hand-writes inline. Requires a word
// character right after the marker (no space) so a markdown "# Heading"
// line never gets mistaken for a #topic tag.
export const TAG_PATTERN = /[#@][A-Za-z0-9][\w-]*/g

export function extractHandTags(text: string): { topics: string[]; entities: string[] } {
  const topics = new Set<string>()
  const entities = new Set<string>()
  for (const match of text.matchAll(TAG_PATTERN)) {
    const word = match[0].slice(1)
    if (match[0][0] === '#') topics.add(word)
    else entities.add(word)
  }
  return { topics: [...topics], entities: [...entities] }
}
