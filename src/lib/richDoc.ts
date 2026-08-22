import type { JSONContent } from '@tiptap/core'

export function splitContent(content: string): { title: string; body: string } {
  const newline = content.indexOf('\n')
  if (newline === -1) return { title: content, body: '' }
  return { title: content.slice(0, newline), body: content.slice(newline + 1).replace(/^\n+/, '') }
}

export function joinContent(title: string, body: string): string {
  const t = title.trim()
  const b = body.trim()
  if (t && b) return `${t}\n\n${b}`
  return t || b
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

// Renders the rich doc down to the plain text the rest of the app (search,
// chunking/embeddings, entry previews) has always run on. Paragraphs join
// on a blank line to match chunkContent's /\n\s*\n/ paragraph splitter
// exactly, so backend chunk boundaries line up with the editor's paragraphs.
// An image node leaves a small textual trace ([image: filename]) so search
// and topic/entity extraction have some awareness it was there, without any
// actual image analysis.
export function docToPlainText(doc: JSONContent): string {
  const paragraphs = doc.content ?? []
  return paragraphs
    .map((paragraph) => {
      const inline = paragraph.content ?? []
      return inline
        .map((node) => {
          if (node.type === 'text') return node.text ?? ''
          if (node.type === 'hardBreak') return '\n'
          if (node.type === 'image') return `[image: ${node.attrs?.filename ?? 'image'}]`
          return ''
        })
        .join('')
    })
    .join('\n\n')
}

// Legacy-hydration only: turns a pre-rich-editor entry's plain-text body
// into an initial doc. Never needs to reconstruct images -- legacy entries
// never had any.
export function plainTextToDoc(text: string): JSONContent {
  const trimmed = text.trim()
  if (!trimmed) return EMPTY_DOC

  const paragraphs = trimmed.split(/\n\s*\n/)
  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => {
      const lines = paragraph.split('\n')
      const content: JSONContent[] = []
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' })
        if (line.length > 0) content.push({ type: 'text', text: line })
      })
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
    }),
  }
}
