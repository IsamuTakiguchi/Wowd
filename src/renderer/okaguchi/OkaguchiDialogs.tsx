import type { Editor } from '@tiptap/react'
import { useUiStore } from '../store/ui'
import { FormatDialog } from './dialogs/FormatDialog'
import { DateDialog } from './dialogs/DateDialog'
import { WideCharDialog } from './dialogs/WideCharDialog'
import { PartyDialog } from './dialogs/PartyDialog'
import { InterestDialog } from './dialogs/InterestDialog'

/**
 * 岡口マクロの入力画面をまとめて出す。開いているのは常に 1 つ。
 *
 * 文字を差し込む画面は、閉じたあとエディタにカーソルを戻す。
 */
export function OkaguchiDialogs({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const dialog = useUiStore((s) => s.dialog)
  const openDialog = useUiStore((s) => s.openDialog)
  const close = (): void => {
    openDialog(null)
    editor?.commands.focus()
  }
  switch (dialog) {
    case 'okaguchiFormat':
      return <FormatDialog onClose={close} />
    case 'okaguchiDate':
      return <DateDialog editor={editor} onClose={close} />
    case 'okaguchiWide':
      return <WideCharDialog editor={editor} onClose={close} />
    case 'okaguchiPerson':
      return <PartyDialog kind="person" editor={editor} onClose={close} />
    case 'okaguchiCorp':
      return <PartyDialog kind="corp" editor={editor} onClose={close} />
    case 'okaguchiInterest':
      return <InterestDialog editor={editor} onClose={close} />
    default:
      return null
  }
}
