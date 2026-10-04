import type { Editor } from '@tiptap/react'
import { useUiStore } from '../store/ui'
import { clearFormatting } from '../editor/commands/format'
import { growFont, stepFont, clearParagraphFormatting, setLineMultiple } from '../editor/commands/word'
import { fallbackSizeHalfPt, startFormatPainter, applyFormatPainter } from './actions'

/**
 * Word のキー。エディタにいるときだけ効かせる。
 *
 * | キー | 動き |
 * |---|---|
 * | Ctrl+Shift+> / < | フォントサイズを一覧の次 / 前へ |
 * | Ctrl+] / [ | フォントサイズを 1pt 大きく / 小さく |
 * | Ctrl+Space | 文字書式の解除 |
 * | Ctrl+Q | 段落書式の解除 |
 * | Ctrl+1 / 5 / 2 | 行間 1 行 / 1.5 行 / 2 行 |
 * | Ctrl+Shift+C / V | 書式のコピー / 貼り付け |
 * | Ctrl+H | 置換 |
 * | Ctrl+G | ジャンプ |
 * | Ctrl+K | ハイパーリンク |
 *
 * 文字ではなくキーの位置 (KeyboardEvent.code) で見る。Shift を押すと「>」「<」になる、
 * 配列によって [ ] の位置が違う、などに左右されないため。
 */
export function handleWordKey(e: KeyboardEvent, editor: Editor | null): boolean {
  if (!editor) return false
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey) return false
  const target = e.target as HTMLElement | null
  if (!target?.closest?.('.ProseMirror')) return false

  const run = (fn: () => void): boolean => {
    e.preventDefault()
    e.stopPropagation()
    fn()
    return true
  }
  const ui = useUiStore.getState()

  if (e.shiftKey) {
    switch (e.code) {
      case 'Period':
        return run(() => growFont(editor, 1, fallbackSizeHalfPt(editor)))
      case 'Comma':
        return run(() => growFont(editor, -1, fallbackSizeHalfPt(editor)))
      case 'KeyC':
        return run(() => startFormatPainter(editor))
      case 'KeyV':
        return run(() => {
          if (!applyFormatPainter(editor)) ui.notify('先に Ctrl+Shift+C で書式をコピーしてください')
        })
      default:
        return false
    }
  }

  switch (e.code) {
    case 'BracketRight':
      return run(() => stepFont(editor, 1, fallbackSizeHalfPt(editor)))
    case 'BracketLeft':
      return run(() => stepFont(editor, -1, fallbackSizeHalfPt(editor)))
    case 'Space':
      return run(() => clearFormatting(editor))
    case 'KeyQ':
      return run(() => clearParagraphFormatting(editor))
    case 'Digit1':
      return run(() => setLineMultiple(editor, 1))
    case 'Digit5':
      return run(() => setLineMultiple(editor, 1.5))
    case 'Digit2':
      return run(() => setLineMultiple(editor, 2))
    case 'KeyH':
      return run(() => ui.toggleFind(true))
    case 'KeyG':
      return run(() => ui.openDialog('goto'))
    case 'KeyK':
      return run(() => ui.openDialog('link'))
    default:
      return false
  }
}
