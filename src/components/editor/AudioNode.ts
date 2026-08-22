import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import AudioNodeView from './AudioNodeView'

export type AudioStatus = 'uploading' | 'ready' | 'error'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entryAudio: {
      insertEntryAudio: (attrs: {
        tempId: string
        filename: string
        status: AudioStatus
        localBlobUrl?: string | null
        durationSeconds?: number | null
      }) => ReturnType
      updateEntryAudio: (
        tempId: string,
        attrs: Partial<{
          status: AudioStatus
          attachmentId: string
          storagePath: string
        }>,
      ) => ReturnType
    }
  }
}

// Mirrors ImageNode.ts closely -- same atom/inline/tempId-addressed
// uploading-placeholder-then-swap shape. The one addition is `transcript`:
// carried on the node purely as data (see AudioNodeView, which never
// renders it) so docToPlainText can fold it into the entry's searchable
// text once the background transcription job fills it in.
const AudioNode = Node.create({
  name: 'audio',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      attachmentId: { default: null },
      storagePath: { default: null },
      filename: { default: 'voice note' },
      status: { default: 'ready' },
      localBlobUrl: { default: null },
      tempId: { default: null },
      durationSeconds: { default: null },
      transcript: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-entry-audio]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-entry-audio': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioNodeView)
  },

  addCommands() {
    return {
      insertEntryAudio:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
      updateEntryAudio:
        (tempId, attrs) =>
        ({ tr, state, dispatch }) => {
          let updated = false
          state.doc.descendants((node, pos) => {
            if (updated) return false
            if (node.type.name === 'audio' && node.attrs.tempId === tempId) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
              updated = true
              return false
            }
            return true
          })
          if (updated && dispatch) dispatch(tr)
          return updated
        },
    }
  },
})

export default AudioNode
