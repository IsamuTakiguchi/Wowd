import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import type { Borders, TableWidth } from '@core/model/types'
import { twipToPt } from '@shared/units'

/**
 * Word の表。
 *
 * prosemirror-tables (@tiptap/extension-table) に、OOXML の属性
 * (tblPr / trPr / tcPr) を持ち回すための属性を足す。
 *
 * ノード名は WowdDoc と揃える必要がある。揃っていないと
 * スキーマ検証で落ちて文書が読み込めない。
 */

function carry<T>(def: T) {
  return { default: def, parseHTML: () => def, renderHTML: () => ({}) }
}

function widthCss(w: TableWidth | null): string | null {
  if (!w) return null
  if (w.type === 'dxa') return `${twipToPt(w.value)}pt`
  // pct は 1/50 パーセント単位
  if (w.type === 'pct') return `${w.value / 50}%`
  return null
}

function bordersCss(borders: Borders | null): Record<string, string> {
  if (!borders) return {}
  const css: Record<string, string> = {}
  const sides = [
    ['top', 'borderTop'],
    ['bottom', 'borderBottom'],
    ['left', 'borderLeft'],
    ['right', 'borderRight']
  ] as const
  for (const [key, prop] of sides) {
    const border = borders[key]
    if (!border || border.val === 'none' || border.val === 'nil') continue
    // w:sz は 1/8 pt 単位
    const width = Math.max(0.5, border.sz / 8)
    const color = border.color && border.color !== 'auto' ? `#${border.color}` : '#000'
    css[prop] = `${width}pt solid ${color}`
  }
  return css
}

function styleString(css: Record<string, string | null | undefined>): string {
  return Object.entries(css)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${v}`)
    .join(';')
}

export const WTable = Table.extend({
  name: 'table',

  addAttributes() {
    return {
      ...this.parent?.(),
      tblStyle: carry<string | null>(null),
      tblW: carry<TableWidth | null>(null),
      jc: carry<string | null>(null),
      grid: carry<number[]>([]),
      borders: carry<Borders | null>(null),
      cellMar: carry<unknown>(null),
      layout: carry<string>('autofit'),
      rawTblPr: carry<string | null>(null)
    }
  },

  renderHTML({ HTMLAttributes, node }) {
    const css: Record<string, string | null> = {
      ...bordersCss(node.attrs['borders'] as Borders | null),
      width: widthCss(node.attrs['tblW'] as TableWidth | null),
      tableLayout: node.attrs['layout'] === 'fixed' ? 'fixed' : null,
      borderCollapse: 'collapse'
    }
    const jc = node.attrs['jc'] as string | null
    if (jc === 'center') css['marginInline'] = 'auto'
    if (jc === 'right') css['marginInlineStart'] = 'auto'

    const style = styleString(css)
    const attrs: Record<string, unknown> = { ...HTMLAttributes, class: 'wowd-table' }
    if (style) attrs['style'] = style
    if (node.attrs['tblStyle']) attrs['data-style'] = node.attrs['tblStyle']

    // 列幅は w:tblGrid で決まっているので colgroup で反映する
    const grid = (node.attrs['grid'] as number[]) ?? []
    const colgroup =
      grid.length > 0
        ? [['colgroup', {}, ...grid.map((w) => ['col', { style: `width:${twipToPt(w)}pt` }])]]
        : []

    return ['table', attrs, ...colgroup, ['tbody', {}, 0]] as never
  }
})

export const WTableRow = TableRow.extend({
  name: 'tableRow',

  addAttributes() {
    return {
      ...this.parent?.(),
      isHeader: carry<boolean>(false),
      height: carry<number | null>(null),
      heightRule: carry<string | null>(null),
      cantSplit: carry<boolean>(false),
      rawTrPr: carry<string | null>(null)
    }
  },

  renderHTML({ HTMLAttributes, node }) {
    const height = node.attrs['height'] as number | null
    const rule = node.attrs['heightRule'] as string | null
    const attrs: Record<string, unknown> = { ...HTMLAttributes }
    if (height != null) {
      // exact は固定高、それ以外は最小高として扱う
      const prop = rule === 'exact' ? 'height' : 'min-height'
      attrs['style'] = `${prop}:${twipToPt(height)}pt`
    }
    return ['tr', attrs, 0]
  }
})

/** セルの共通属性。ヘッダーセルと通常セルで同じものを持つ */
function cellAttributes(parent: (() => Record<string, unknown>) | undefined) {
  return {
    ...parent?.(),
    tcW: carry<TableWidth | null>(null),
    vAlign: carry<string>('top'),
    borders: carry<Borders | null>(null),
    shd: carry<string | null>(null),
    rawTcPr: carry<string | null>(null)
  }
}

function renderCell(
  tag: 'td' | 'th',
  HTMLAttributes: Record<string, unknown>,
  attrs: Record<string, unknown>
): [string, Record<string, unknown>, number] {
  const css: Record<string, string | null> = {
    ...bordersCss(attrs['borders'] as Borders | null),
    width: widthCss(attrs['tcW'] as TableWidth | null),
    verticalAlign: (attrs['vAlign'] as string) || 'top'
  }
  const shd = attrs['shd'] as string | null
  if (shd && shd !== 'auto') css['backgroundColor'] = `#${shd}`

  const style = styleString(css)
  const out: Record<string, unknown> = { ...HTMLAttributes }
  if (style) out['style'] = style
  return [tag, out, 0]
}

export const WTableCell = TableCell.extend({
  name: 'tableCell',
  addAttributes() {
    return cellAttributes(this.parent as never)
  },
  renderHTML({ HTMLAttributes, node }) {
    return renderCell('td', HTMLAttributes, node.attrs) as never
  }
})

export const WTableHeader = TableHeader.extend({
  name: 'tableHeader',
  addAttributes() {
    return cellAttributes(this.parent as never)
  },
  renderHTML({ HTMLAttributes, node }) {
    return renderCell('th', HTMLAttributes, node.attrs) as never
  }
})
