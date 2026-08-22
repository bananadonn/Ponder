import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TAG_PATTERN } from '../../lib/tags'

// Native replacement for the old textarea-backdrop highlight hack: computed
// fresh from doc state on every transaction via ProseMirror decorations,
// never mutating the document. Same #topic/@entity -> sky-600/amber-600
// coloring as before.
const TagHighlightExtension = Extension.create({
  name: 'tagHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tagHighlight'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              for (const match of node.text.matchAll(TAG_PATTERN)) {
                const from = pos + (match.index ?? 0)
                const to = from + match[0].length
                const kind = match[0][0] === '#' ? 'text-sky-600' : 'text-amber-600'
                decorations.push(Decoration.inline(from, to, { class: kind }))
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

export default TagHighlightExtension
