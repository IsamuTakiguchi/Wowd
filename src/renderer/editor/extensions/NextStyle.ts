import { Extension } from '@tiptap/core'
import type { StyleTable } from '@core/model/types'

/**
 * 段落の終わりで Enter を押したら、次の段落を「次の段落のスタイル」にする (Word と同じ)。
 *
 * 例: 見出し 1 の終わりで Enter → 次は標準。岡口マクロのランク１ → 本文１。
 * これが無いと、見出しの次の行まで見出しのままになり、番号まで付いてしまう。
 *
 * 段落の途中で Enter を押したとき (段落を 2 つに割るとき) は、Word と同じく同じスタイルのまま。
 * 新しい段落の直接の書式 (字下げ・配置・番号) は持ち越さない。スタイルが決めるため。
 */
export const NextStyle = Extension.create({
  name: 'wowdNextStyle',
  // リストなどの Enter より先に見る。当てはまらなければ何もせず次へ回す
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        const parent = $from.parent
        if (!parent.isTextblock || $from.parentOffset !== parent.content.size) return false
        const pStyle = (parent.attrs['pStyle'] as string | null | undefined) ?? null
        if (!pStyle) return false
        const styles = (this.editor.storage as unknown as Record<string, { styles?: StyleTable | null }>)['wowdNumbering']
          ?.styles
        const next = styles?.byId.get(pStyle)?.next
        if (!next || next === pStyle) return false
        const nextStyle = styles?.byId.get(next)
        if (!nextStyle || nextStyle.type !== 'paragraph') return false
        const isDefault = next === styles?.defaults.paragraph

        return this.editor
          .chain()
          .splitBlock()
          .command(({ tr }) => {
            const $pos = tr.selection.$from
            const pos = $pos.before()
            const node = tr.doc.nodeAt(pos)
            const paragraph = tr.doc.type.schema.nodes['paragraph']
            if (!node || !paragraph) return false
            const attrs = {
              ...node.attrs,
              pStyle: isDefault ? null : next,
              numPr: null,
              ind: null,
              jc: null,
              spacing: null,
              outlineLvl: null
            }
            tr.setNodeMarkup(pos, paragraph, paragraph.create(attrs).attrs)
            return true
          })
          .run()
      }
    }
  }
})
