import type { Editor } from '@tiptap/react'
import { useUiStore } from '../store/ui'
import { ParagraphDialog } from './dialogs/ParagraphDialog'
import { LinkDialog } from './dialogs/LinkDialog'
import { GotoDialog } from './dialogs/GotoDialog'
import { SymbolDialog } from './dialogs/SymbolDialog'
import { WordCountDialog } from './dialogs/WordCountDialog'
import { fallbackSizeHalfPt } from './actions'

/** Word と同じ画面 (段落・リンク・ジャンプ・記号・文字カウント) */
export function WordDialogs({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const dialog = useUiStore((s) => s.dialog)
  const openDialog = useUiStore((s) => s.openDialog)
  if (!editor) return null
  const close = (): void => {
    openDialog(null)
    editor.commands.focus()
  }
  switch (dialog) {
    case 'paragraph':
      return <ParagraphDialog editor={editor} sizePt={fallbackSizeHalfPt(editor) / 2} onClose={close} />
    case 'link':
      return <LinkDialog editor={editor} onClose={close} />
    case 'goto':
      return <GotoDialog editor={editor} onClose={close} />
    case 'symbol':
      return <SymbolDialog editor={editor} onClose={close} />
    case 'wordCount':
      return <WordCountDialog editor={editor} onClose={close} />
    default:
      return null
  }
}
