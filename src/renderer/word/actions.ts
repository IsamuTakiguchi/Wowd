import type { Editor } from '@tiptap/react'
import { effectiveRunProps } from '@core/docx/read/styles'
import { useDocumentStore } from '../store/document'
import { useUiStore } from '../store/ui'
import { platform } from '../platform'
import { copyFormat, pasteFormat, type CopiedFormat } from '../editor/commands/word'

/** 文字に大きさの指定が無いときの大きさ (段落スタイル → 既定の順。半ポイント) */
export function fallbackSizeHalfPt(editor: Editor): number {
  const styles = useDocumentStore.getState().document?.resources.styles
  if (!styles) return 21
  const pStyle = (editor.state.selection.$from.parent.attrs['pStyle'] as string | null) ?? styles.defaults.paragraph
  return effectiveRunProps(styles, pStyle).sz ?? styles.docDefaults.rPr?.sz ?? 21
}

/**
 * 切り取り・コピー・貼り付け (ボタン・右クリックから)。
 *
 * ブラウザ版の貼り付けはページから起こせないので、文字だけなら読み取りを試み、
 * それも許されなければ Ctrl+V を案内する。
 */
export async function clipboard(editor: Editor, action: 'cut' | 'copy' | 'paste'): Promise<void> {
  editor.commands.focus()
  if (await platform.clipboardAction(action)) return
  if (action === 'paste') {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        editor.chain().focus().insertContent(text).run()
        return
      }
    } catch {
      // 読み取りを許されなかった
    }
    useUiStore.getState().notify('貼り付けは Ctrl+V (Mac は ⌘+V) を押してください')
  }
}

/**
 * 書式のコピー (ブラシ)。押すと、いまの位置の書式を写し取って「貼り付け待ち」になる。
 * 次に選んだ文字に当たる。sticky なら Esc を押すまで何度でも当てられる (Word のダブルクリック)
 */
export function startFormatPainter(editor: Editor, sticky = false): void {
  const ui = useUiStore.getState()
  if (ui.formatPainter && !sticky) {
    ui.setFormatPainter(null)
    return
  }
  ui.setFormatPainter({ format: copyFormat(editor), sticky })
  editor.commands.focus()
}

/** 写した書式をいまの選択に当てる。Ctrl+Shift+V からも呼ぶ */
export function applyFormatPainter(editor: Editor): boolean {
  const ui = useUiStore.getState()
  const painter = ui.formatPainter
  if (!painter) return false
  pasteFormat(editor, painter.format as CopiedFormat)
  if (!painter.sticky) ui.setFormatPainter(null)
  return true
}

/**
 * ブラシの「貼り付け待ち」の間、本文でマウスを離したら当てる。Esc でやめる。
 * @returns 後始末
 */
export function startFormatPainterListener(getEditor: () => Editor | null): () => void {
  const onMouseUp = (e: MouseEvent): void => {
    const editor = getEditor()
    if (!editor || !useUiStore.getState().formatPainter) return
    if (!(e.target as HTMLElement | null)?.closest?.('.ProseMirror')) return
    // ProseMirror が選択を読み取ってから当てる
    setTimeout(() => applyFormatPainter(editor), 0)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && useUiStore.getState().formatPainter) useUiStore.getState().setFormatPainter(null)
  }
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKey)
  return () => {
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('keydown', onKey)
  }
}
