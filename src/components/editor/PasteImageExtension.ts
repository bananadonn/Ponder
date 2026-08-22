import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'

export interface PasteImageOptions {
  onImageFiles: (files: File[]) => void
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}

// Paste/drop interception for images, kept separate from upload/insert logic
// (src/components/editor/uploadImage.ts) -- this extension only detects
// image files and hands them off via a callback.
const PasteImageExtension = Extension.create<PasteImageOptions>({
  name: 'pasteImage',

  addOptions() {
    return {
      onImageFiles: () => {},
    }
  },

  addProseMirrorPlugins() {
    const { onImageFiles } = this.options
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const files = imageFiles(event.clipboardData?.files)
            if (files.length === 0) return false
            event.preventDefault()
            onImageFiles(files)
            return true
          },
          handleDrop(view, event) {
            const files = imageFiles(event.dataTransfer?.files)
            if (files.length === 0) return false
            event.preventDefault()

            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (coords) {
              const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, coords.pos))
              view.dispatch(tr)
            }
            onImageFiles(files)
            return true
          },
        },
      }),
    ]
  },
})

export default PasteImageExtension
