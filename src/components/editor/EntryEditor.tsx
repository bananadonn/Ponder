import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { useRef } from 'react'
import type { JSONContent } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Placeholder from '@tiptap/extension-placeholder'
import ImageNode from './ImageNode'
import TagHighlightExtension from './TagHighlightExtension'
import PasteImageExtension from './PasteImageExtension'
import { EMPTY_DOC } from '../../lib/richDoc'

export interface UseEntryEditorOptions {
  onUpdate: (doc: JSONContent) => void
  onImageFiles: (files: File[]) => void
}

// Deliberately minimal schema -- no @tiptap/starter-kit, since its
// Heading/Bold/Italic/List extensions come with markdown input rules
// (e.g. "# " -> a real heading) that would start interpreting text this app
// has always treated as literal characters. Just paragraphs, line breaks,
// inline images, and the #topic/@entity decoration.
export function useEntryEditor({ onUpdate, onImageFiles }: UseEntryEditorOptions): Editor | null {
  // Extensions are only read once at editor creation (deps=[] below), so
  // the callbacks they close over are looked up through refs at call time
  // rather than baked in stale.
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const onImageFilesRef = useRef(onImageFiles)
  onImageFilesRef.current = onImageFiles

  return useEditor(
    {
      extensions: [
        Document,
        Paragraph,
        Text,
        HardBreak,
        History,
        Placeholder.configure({
          placeholder: 'Write… #topic and @entity are picked up automatically',
        }),
        ImageNode,
        TagHighlightExtension,
        PasteImageExtension.configure({
          onImageFiles: (files) => onImageFilesRef.current(files),
        }),
      ],
      content: EMPTY_DOC,
      immediatelyRender: true,
      onUpdate: ({ editor }) => onUpdateRef.current(editor.getJSON()),
      editorProps: {
        attributes: {
          class: 'h-full font-mono text-sm leading-relaxed text-mist-800 focus:outline-none',
        },
      },
    },
    [],
  )
}

export function EntryEditorContent({ editor }: { editor: Editor | null }) {
  return <EditorContent editor={editor} className="h-full" />
}
