import type { Editor } from '@tiptap/react'
import { applyRank, restartRank, setupRankStyles, fixRankHalfWidth } from './rank'
import { useUiStore, type DialogKind } from '../store/ui'

/**
 * 岡口マクロのキー割り当て。元のマクロ (Normal.dotm に登録するもの) と同じキーにする。
 *
 * 文字ではなくキーの位置 (KeyboardEvent.code) で見る。Mac の Option+数字は
 * 「¡」などの文字になり、e.key では判別できないため。
 */
export type OkaguchiAction = (editor: Editor) => boolean

const actions = new Map<string, OkaguchiAction>()

/** フォームなど、あとから足す操作を登録する */
export function registerOkaguchiKey(combo: string, action: OkaguchiAction): void {
  actions.set(combo, action)
}

for (let n = 1; n <= 8; n++) {
  actions.set(`Alt+Digit${n}`, (editor) => applyRank(editor, n))
  actions.set(`Alt+Shift+Digit${n}`, (editor) => restartRank(editor, n))
}
actions.set('Alt+KeyR', (editor) => setupRankStyles(editor) !== null)
actions.set('Alt+Shift+KeyR', (editor) => fixRankHalfWidth(editor))

/** 入力画面を開くキー (元のマクロのフォームと同じ割り当て) */
const DIALOG_KEYS: [string, DialogKind][] = [
  ['Alt+KeyP', 'okaguchiFormat'],
  ['Alt+KeyT', 'okaguchiDate'],
  ['Alt+KeyZ', 'okaguchiWide'],
  ['Alt+KeyM', 'okaguchiPerson'],
  ['Alt+KeyK', 'okaguchiCorp'],
  ['Alt+KeyC', 'okaguchiInterest'],
  ['Alt+KeyB', 'okaguchiProperty'],
  ['Alt+KeyJ', 'okaguchiPostSet']
]
for (const [combo, kind] of DIALOG_KEYS) {
  actions.set(combo, () => {
    useUiStore.getState().openDialog(kind)
    return true
  })
}

/** 押されたキーに対応する操作の名前。対応が無ければ null */
export function comboOf(e: KeyboardEvent): string | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null
  return `Alt+${e.shiftKey ? 'Shift+' : ''}${e.code}`
}

/**
 * キー入力を受ける。処理したら true (呼び出し側で既定動作を止める)。
 *
 * 入力欄 (ダイアログの中など) で押されたときは横取りしない。
 * Alt+R を止めないと、Windows ではメニューの「校閲(&R)」が開いてしまう。
 */
export function handleOkaguchiKey(e: KeyboardEvent, editor: Editor | null): boolean {
  const combo = comboOf(e)
  if (!combo || !editor) return false
  const action = actions.get(combo)
  if (!action) return false
  const target = e.target as HTMLElement | null
  const inEditor = target?.closest?.('.ProseMirror') != null
  const inField = target != null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  if (inField && !inEditor) return false
  if (target?.closest?.('dialog, [role="dialog"]')) return false
  e.preventDefault()
  e.stopPropagation()
  action(editor)
  return true
}
