import { Node, mergeAttributes } from '@tiptap/core'

/**
 * モデル化していない OOXML をそのまま抱えるノード。
 *
 * 「対応するまで落とす」ではなく「対応するまで触らない」ための仕組み。
 * 編集はできないが、保存時に元の XML がそのまま書き戻されるので内容は失われない。
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      xml: { default: '', parseHTML: () => '', renderHTML: () => ({}) },
      label: { default: '', parseHTML: () => '', renderHTML: () => ({}) }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-raw-block]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-raw-block': '',
        class: 'wowd-raw wowd-raw-block',
        title: 'Wowd が扱えない要素です。保存時は元の内容のまま書き戻されます。'
      }),
      String(node.attrs['label'] || '未対応の要素')
    ]
  }
})

export const RawRun = Node.create({
  name: 'rawRun',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      xml: { default: '', parseHTML: () => '', renderHTML: () => ({}) },
      label: { default: '', parseHTML: () => '', renderHTML: () => ({}) }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-raw-run]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-raw-run': '',
        class: 'wowd-raw wowd-raw-run',
        title: 'Wowd が扱えない要素です。保存時は元の内容のまま書き戻されます。'
      }),
      String(node.attrs['label'] || '?')
    ]
  }
})
