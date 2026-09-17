import { Extension } from '@tiptap/core'
import { selectAll } from '@tiptap/pm/commands'
import type { Justification } from '@core/model/types'
import { setAlignment, changeIndent } from '../commands/format'

/**
 * Word 互換のキーボード操作。
 *
 * Ctrl+A をここで受けるのが要点。ProseMirror の基本キーマップに Mod-a は無く、
 * 何も登録しないとブラウザ既定の「すべて選択」に任せることになる。
 * その場合 ProseMirror の選択は DOM 側の変化を非同期に読み戻すまで変わらず、
 * 「選択されているか」で有効無効を決める操作 (コメントの追加など) が
 * 一拍遅れて反応する。同期的なコマンドとして処理してこのずれを無くす。
 */
export const Shortcuts = Extension.create({
  name: 'wowdShortcuts',

  addKeyboardShortcuts() {
    const align =
      (jc: Justification) =>
      (): boolean => {
        setAlignment(this.editor, jc)
        return true
      }

    return {
      'Mod-a': () => selectAll(this.editor.state, this.editor.view.dispatch),
      // 配置。Word と同じ割り当て
      'Mod-l': align('left'),
      'Mod-e': align('center'),
      'Mod-r': align('right'),
      'Mod-j': align('both'),
      // インデントの増減
      'Mod-m': () => {
        changeIndent(this.editor, 1)
        return true
      },
      'Mod-Shift-m': () => {
        changeIndent(this.editor, -1)
        return true
      }
    }
  }
})
