import { Mark, mergeAttributes } from '@tiptap/core'
import type { RevisionMeta } from '@core/model/types'
import { authorColor } from '@core/revisions/authorColor'

/**
 * WowdDoc が生成しうるマークのうち、これまでスキーマに無かったもの。
 *
 * ノードと同じく、スキーマに無いマークを含む JSON は ProseMirror が
 * 例外にする。変更履歴やコメントの付いた文書がまるごと読めなくなるので、
 * モデルが作りうるマークはすべて登録しておく必要がある。
 */

function carry<T>(def: T) {
  return { default: def, parseHTML: () => def, renderHTML: () => ({}) }
}

/** w:dstrike — 二重取り消し線 */
export const DoubleStrike = Mark.create({
  name: 'doubleStrike',
  parseHTML() {
    return [{ tag: 's[data-double]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      's',
      mergeAttributes(HTMLAttributes, {
        'data-double': '',
        style: 'text-decoration:line-through double'
      }),
      0
    ]
  }
})

/** w:hyperlink — リンク。r:id か w:anchor のどちらかを持つ */
export const WLink = Mark.create({
  name: 'link',
  inclusive: false,

  addAttributes() {
    return {
      href: carry<string | null>(null),
      anchor: carry<string | null>(null),
      rId: carry<string | null>(null),
      tooltip: carry<string | null>(null)
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-wowd-link]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // 実際の遷移先は r:id 経由で rels に入っているので href は出さない。
    // 外部リンクをそのまま踏ませないためでもある
    return ['a', mergeAttributes(HTMLAttributes, { 'data-wowd-link': '', class: 'wowd-link' }), 0]
  }
})

/**
 * w:commentRangeStart 〜 End の範囲。
 *
 * 範囲はインライン要素をまたぐのでノードではなくマークで表す。
 * 重なり合うコメントは ids に積む。
 */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return { ids: carry<string[]>([]) }
  },

  parseHTML() {
    return [{ tag: 'span[data-wowd-comment]' }]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const ids = (mark.attrs['ids'] as string[]) ?? []
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wowd-comment': ids.join(' '),
        class: 'wowd-comment'
      }),
      0
    ]
  }
})

function revisionAttributes() {
  return {
    id: carry<number>(0),
    author: carry<string>(''),
    date: carry<string>('')
  }
}

/** w:ins — 変更履歴の挿入 */
export const InsertionMark = Mark.create({
  name: 'insertion',
  inclusive: false,

  addAttributes() {
    return revisionAttributes()
  },

  parseHTML() {
    return [{ tag: 'ins[data-wowd-ins]' }]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const meta = mark.attrs as unknown as RevisionMeta
    return [
      'ins',
      mergeAttributes(HTMLAttributes, {
        'data-wowd-ins': '',
        class: 'wowd-ins',
        // 著者ごとの色。見た目は CSS 側でこの変数を使う
        style: `--wowd-author:${authorColor(meta.author)}`,
        title: meta.author ? `${meta.author} が挿入` : undefined
      }),
      0
    ]
  }
})

/**
 * w:del — 変更履歴の削除。
 * 文字は消さずに残し、取り消し線で示す。承諾するまでは文書の一部。
 */
export const DeletionMark = Mark.create({
  name: 'deletion',
  inclusive: false,

  addAttributes() {
    return revisionAttributes()
  },

  parseHTML() {
    return [{ tag: 'del[data-wowd-del]' }]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const meta = mark.attrs as unknown as RevisionMeta
    return [
      'del',
      mergeAttributes(HTMLAttributes, {
        'data-wowd-del': '',
        class: 'wowd-del',
        style: `--wowd-author:${authorColor(meta.author)}`,
        title: meta.author ? `${meta.author} が削除` : undefined
      }),
      0
    ]
  }
})
