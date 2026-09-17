import Heading from '@tiptap/extension-heading'
import { paragraphAttributeSpec, paragraphAttrsToStyle } from './paragraphAttrs'

/**
 * 見出し。Word では w:p + pStyle="Heading1" + outlineLvl なので、
 * 段落属性を丸ごと共有する。level はスタイル ID と outlineLvl の両方に写す。
 */
export const WHeading = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), ...paragraphAttributeSpec() }
  },

  renderHTML({ node, HTMLAttributes }) {
    const levels = this.options.levels
    const level: number = levels.includes(node.attrs['level']) ? node.attrs['level'] : levels[0]!
    const style = paragraphAttrsToStyle(node.attrs)
    const attrs: Record<string, unknown> = { ...HTMLAttributes }
    if (style) attrs['style'] = style
    if (node.attrs['pStyle']) attrs['data-style'] = node.attrs['pStyle']
    return [`h${level}`, attrs, 0]
  }
})
