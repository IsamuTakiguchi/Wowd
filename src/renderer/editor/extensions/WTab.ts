import { Node, mergeAttributes } from '@tiptap/core'

/** w:tab。Word のタブは空白文字ではなくコンテンツなので独立ノードにする */
export const WTab = Node.create({
  name: 'wTab',
  group: 'inline',
  inline: true,
  atom: true,

  parseHTML() {
    return [{ tag: 'span[data-w-tab]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-w-tab': '', class: 'wowd-tab' }), '	']
  },

  addKeyboardShortcuts() {
    return {
      // リスト内の Tab はレベル変更に使うので、そちらが処理しなかった場合だけタブ文字を入れる
      Tab: () => this.editor.commands.insertContent({ type: this.name })
    }
  }
})
