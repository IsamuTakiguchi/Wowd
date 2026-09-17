import { Node, mergeAttributes } from '@tiptap/core'

/** w:br w:type="page"。HorizontalRule とは別物で、ページネータが強制改ページとして扱う */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'wowd-page-break' }),
      '改ページ'
    ]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }: { commands: { insertContent: (c: unknown) => boolean } }) =>
          commands.insertContent({ type: this.name })
    } as never
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertContent({ type: this.name })
    }
  }
})

/** w:sectPr。セクション本体は WowdResources.sections に置き、ここは参照だけ持つ */
export const SectionBreak = Node.create({
  name: 'sectionBreak',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { sectionId: { default: '', parseHTML: () => '', renderHTML: () => ({}) } }
  },

  parseHTML() {
    return [{ tag: 'div[data-section-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-section-break': '', class: 'wowd-section-break' }),
      'セクション区切り'
    ]
  }
})
