import { Node, mergeAttributes } from '@tiptap/core'
import type { RunProps } from '@core/model/types'

/**
 * WowdDoc に現れるインラインノードのうち、これまでスキーマに無かったもの。
 *
 * スキーマに無いノードを含む JSON を ProseMirror に渡すと例外になり、
 * 文書がまるごと読み込めない。そのまま保存すると中身が失われるので、
 * モデルが生成しうるノードはすべてスキーマに登録しておく必要がある。
 */

/** 持ち回すだけで HTML には出さない属性 */
function carry<T>(def: T) {
  return { default: def, parseHTML: () => def, renderHTML: () => ({}) }
}

/**
 * w:ruby — ふりがな。
 *
 * ベース文字は編集可能な内容として持ち、ふりがな (rt) は属性に置く。
 * rt を ProseMirror の内容にすると位置計算が一段複雑になるうえ、
 * 検索や選択がルビ文字を拾ってしまう。
 */
export const Ruby = Node.create({
  name: 'ruby',
  group: 'inline',
  inline: true,
  content: 'text*',
  // ベース文字は編集できる。ルビ文字はダイアログで編集する
  atom: false,

  addAttributes() {
    return {
      rt: {
        default: '',
        parseHTML: (el) => el.querySelector('rt')?.textContent ?? '',
        // 属性としては出さない。<rt> 要素として描くので二重になる
        renderHTML: () => ({})
      },
      rubyAlign: carry<string>('distributeSpace'),
      hps: carry<number | null>(null),
      hpsRaise: carry<number | null>(null),
      hpsBaseText: carry<number | null>(null),
      lid: carry<string>('ja-JP'),
      rtProps: carry<RunProps | null>(null)
    }
  },

  parseHTML() {
    return [{ tag: 'ruby' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    // ProseMirror はコンテンツホール (0) が親の唯一の子であることを要求する。
    // <ruby> の直下にホールと <rt> を並べると
    // "Content hole must be the only child of its parent node" で文書ごと読めなくなる。
    // ベース文字を span で包んで、その中だけをホールにする。
    return [
      'ruby',
      mergeAttributes(HTMLAttributes, { 'data-wowd-ruby': '' }),
      ['span', { class: 'wowd-ruby-base' }, 0],
      ['rt', { contenteditable: 'false' }, String(node.attrs['rt'] ?? '')]
    ]
  }
})

/**
 * w:fldSimple / w:fldChar — フィールド。
 *
 * PAGE や TOC のように、命令とキャッシュされた結果を持つ小さな言語。
 * 平テキストに潰すと不可逆になるのでノードとして保持する。
 */
export const Field = Node.create({
  name: 'field',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      instr: carry<string>(''),
      cachedText: carry<string>(''),
      dirty: carry<boolean>(false)
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wowd-field]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wowd-field': '',
        class: 'wowd-field',
        title: String(node.attrs['instr'] ?? '')
      }),
      String(node.attrs['cachedText'] ?? '')
    ]
  }
})

/**
 * w:bookmarkStart / w:bookmarkEnd — 目次や相互参照の位置指標。
 * 幅を持たないので、表示上は何も出さない。
 */
export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: carry<string>(''),
      name: carry<string>(''),
      isEnd: carry<boolean>(false)
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wowd-bookmark]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wowd-bookmark': String(node.attrs['name'] ?? ''),
        class: 'wowd-bookmark'
      })
    ]
  }
})

/** w:br — 段落内の改行 (改ページ以外) */
export const WBreak = Node.create({
  name: 'wBreak',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      breakType: carry<string>('textWrapping'),
      clear: carry<string | null>(null)
    }
  },

  parseHTML() {
    return [{ tag: 'br[data-wowd-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['br', mergeAttributes(HTMLAttributes, { 'data-wowd-break': '' })]
  }
})
