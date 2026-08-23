import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ImageNodeView from './ImageNodeView'

export type ImageStatus = 'uploading' | 'ready' | 'error'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entryImage: {
      insertEntryImage: (attrs: {
        tempId: string
        filename: string
        status: ImageStatus
        localBlobUrl?: string | null
      }) => ReturnType
      updateEntryImage: (
        tempId: string,
        attrs: Partial<{
          status: ImageStatus
          attachmentId: string
          storagePath: string
          mimeType: string
        }>,
      ) => ReturnType
    }
  }
}

const ImageNode = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      attachmentId: { default: null },
      storagePath: { default: null },
      filename: { default: 'image' },
      mimeType: { default: null },
      status: { default: 'ready' },
      localBlobUrl: { default: null },
      tempId: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-entry-image]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { 'data-entry-image': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },

  addCommands() {
    return {
      insertEntryImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
      updateEntryImage:
        (tempId, attrs) =>
        ({ tr, state, dispatch }) => {
          let updated = false
          state.doc.descendants((node, pos) => {
            if (updated) return false
            if (node.type.name === 'image' && node.attrs.tempId === tempId) {
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

export default ImageNode
