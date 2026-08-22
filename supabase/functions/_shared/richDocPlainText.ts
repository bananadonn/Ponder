// Server-side port of docToPlainText (src/lib/richDoc.ts) -- the Edge
// Function can't import that browser module directly, so this mirrors just
// the node-type handling it needs. Keep this in sync with richDoc.ts by
// hand whenever a new inline node type is added to the composer.
//
// Used only by transcribe-audio's write-back step: once a transcript is
// ready, it's the plain-text side of turning the patched content_doc back
// into entries.content so the existing chunking/embedding pipeline sees it.

// Loosely typed on purpose -- this only ever receives content_doc JSON
// straight from Postgres, not a real ProseMirror document.
interface RichDocNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: RichDocNode[]
}

// Ports of splitContent/joinContent (src/lib/richDoc.ts) -- entries.content
// is "title\n\nbody", and content_doc only ever represents the body, so
// recomputing content after patching content_doc still needs the title
// half preserved verbatim from the entry's current content.
export function splitContentTitle(content: string): string {
  const newline = content.indexOf('\n')
  return newline === -1 ? content : content.slice(0, newline)
}

export function joinContent(title: string, body: string): string {
  const t = title.trim()
  const b = body.trim()
  if (t && b) return `${t}\n\n${b}`
  return t || b
}

export function richDocPlainText(doc: RichDocNode): string {
  const paragraphs = doc.content ?? []
  return paragraphs
    .map((paragraph) => {
      const inline = paragraph.content ?? []
      return inline
        .map((node) => {
          if (node.type === 'text') return node.text ?? ''
          if (node.type === 'hardBreak') return '\n'
          if (node.type === 'image') return `[image: ${node.attrs?.filename ?? 'image'}]`
          if (node.type === 'audio') return (node.attrs?.transcript as string | undefined) || '[voice note]'
          return ''
        })
        .join('')
    })
    .join('\n\n')
}

// Finds the audio node with attrs.attachmentId === attachmentId anywhere in
// the doc and sets its transcript attr, returning a new doc (the input is
// never mutated). Returns null if no matching node was found, so the caller
// can tell "nothing to patch" apart from "patched, transcript happens to be
// empty" -- e.g. the entry's content_doc was edited/replaced client-side
// between the recording landing and transcription finishing.
export function setAudioTranscript(doc: RichDocNode, attachmentId: string, transcript: string): RichDocNode | null {
  let found = false

  function walk(node: RichDocNode): RichDocNode {
    if (node.type === 'audio' && node.attrs?.attachmentId === attachmentId) {
      found = true
      return { ...node, attrs: { ...node.attrs, transcript } }
    }
    if (node.content) {
      return { ...node, content: node.content.map(walk) }
    }
    return node
  }

  const patched = walk(doc)
  return found ? patched : null
}
