import { Node, mergeAttributes } from '@tiptap/core'
import { emuToPx } from '@shared/units'
import { mediaRegistry } from '../media'

/**
 * w:drawing — 画像。
 *
 * TipTap の Image 拡張は src しか持たないので使わない。
 * Word の画像は関係 ID とメディアパートを指し、大きさは EMU で入っている。
 * 表示に使う blob URL は文書のメディアから作るので、ここでは持たない。
 */
export const WImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    const carry = <T,>(def: T) => ({ default: def, parseHTML: () => def, renderHTML: () => ({}) })
    return {
      mediaKey: carry<string>(''),
      relId: carry<string | null>(null),
      cx: carry<number>(0),
      cy: carry<number>(0),
      wrap: carry<string>('inline'),
      name: carry<string>(''),
      descr: carry<string>(''),
      inline: carry<boolean>(true),
      /** モデル化しきれない w:drawing 全体。保存時はこれを書き戻す */
      rawDrawing: carry<string | null>(null)
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-wowd-image]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = emuToPx(Number(node.attrs['cx'] ?? 0))
    const height = emuToPx(Number(node.attrs['cy'] ?? 0))
    const mediaKey = String(node.attrs['mediaKey'] ?? '')
    // 画像の中身は文書の中にバイト列で入っているので blob URL に変える
    const src = mediaRegistry.get(mediaKey)

    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-wowd-image': mediaKey,
        class: 'wowd-image',
        // 解決できない画像も枠だけ出す。消えるとレイアウトがずれて
        // 「何かあったはず」ということすら分からなくなる
        src: src ?? undefined,
        alt: String(node.attrs['descr'] ?? node.attrs['name'] ?? ''),
        width: width > 0 ? Math.round(width) : undefined,
        height: height > 0 ? Math.round(height) : undefined
      })
    ]
  }
})
