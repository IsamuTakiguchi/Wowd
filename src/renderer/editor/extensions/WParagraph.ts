import Paragraph from '@tiptap/extension-paragraph'
import { paragraphAttributeSpec, paragraphAttrsToStyle } from './paragraphAttrs'

/**
 * Word の w:p に対応する段落。
 * TipTap 既定の paragraph を拡張し、pPr 相当の属性を全部持たせる。
 */
export const WParagraph = Paragraph.extend({
  addAttributes() {
    return { ...this.parent?.(), ...paragraphAttributeSpec() }
  },

  renderHTML({ HTMLAttributes, node }) {
    const style = paragraphAttrsToStyle(node.attrs)
    const attrs: Record<string, unknown> = { ...HTMLAttributes }
    if (style) attrs['style'] = style
    if (node.attrs['pStyle']) attrs['data-style'] = node.attrs['pStyle']
    if (node.attrs['numPr']) {
      attrs['data-num-id'] = String(node.attrs['numPr'].numId)
      attrs['data-ilvl'] = String(node.attrs['numPr'].ilvl)
    }
    // 段落記号そのものの挿入・削除。行末の ¶ を CSS で出すための印
    const revision = node.attrs['paraMarkRevision'] as { kind: string } | null
    if (revision) attrs['data-para-revision'] = revision.kind
    return ['p', attrs, 0]
  }
})
