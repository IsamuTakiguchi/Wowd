import type {
  BlockNode,
  TableNode,
  TableCellNode,
  TableWidth,
  Borders,
  Margins,
  SectionProps,
  WowdDoc
} from '../../model/types'
import { el, wrap, valEl, type AttrMap } from '../xml'
import { TBLPR_ORDER, TCPR_ORDER, emitOrdered, splitFragments, type OrderedFragment } from './order'
import { writeParagraph } from './paragraph'
import { writeSectionProps } from './section'

function widthAttrs(w: TableWidth | null): AttrMap {
  return w ? { 'w:w': w.value, 'w:type': w.type } : {}
}

function writeBorders(tag: string, borders: Borders | null): string {
  if (!borders) return ''
  let inner = ''
  for (const [side, b] of Object.entries(borders)) {
    if (!b) continue
    inner += el(`w:${side}`, {
      'w:val': b.val,
      'w:sz': b.sz,
      'w:space': b.space,
      'w:color': b.color
    })
  }
  return inner ? wrap(tag, undefined, inner) : ''
}

function writeMargins(tag: string, margins: Margins | null): string {
  if (!margins) return ''
  let inner = ''
  for (const [side, v] of Object.entries(margins)) {
    if (v == null) continue
    inner += el(`w:${side}`, { 'w:w': v, 'w:type': 'dxa' })
  }
  return inner ? wrap(tag, undefined, inner) : ''
}

function writeTable(table: TableNode, sections: Map<string, SectionProps>): string {
  const frags: OrderedFragment[] = []
  const add = (tag: string, xml: string): void => {
    if (xml) frags.push({ tag, xml })
  }

  if (table.attrs.tblStyle) add('w:tblStyle', valEl('w:tblStyle', table.attrs.tblStyle))
  if (table.attrs.tblW) add('w:tblW', el('w:tblW', widthAttrs(table.attrs.tblW)))
  if (table.attrs.jc) add('w:jc', valEl('w:jc', table.attrs.jc))
  add('w:tblBorders', writeBorders('w:tblBorders', table.attrs.borders))
  if (table.attrs.layout === 'fixed') add('w:tblLayout', el('w:tblLayout', { 'w:type': 'fixed' }))
  add('w:tblCellMar', writeMargins('w:tblCellMar', table.attrs.cellMar))
  for (const frag of splitFragments(table.attrs.rawTblPr)) frags.push(frag)

  const tblPr = wrap('w:tblPr', undefined, emitOrdered(TBLPR_ORDER, frags))
  const tblGrid = wrap(
    'w:tblGrid',
    undefined,
    table.attrs.grid.map((w) => el('w:gridCol', { 'w:w': w })).join('')
  )

  const rows = table.content
    .map((row) => {
      const trPr = writeRowProps(row)
      const cells = row.content.map((cell) => writeCell(cell, sections)).join('')
      return wrap('w:tr', undefined, trPr + cells)
    })
    .join('')

  return wrap('w:tbl', undefined, tblPr + tblGrid + rows)
}

function writeRowProps(row: TableNode['content'][number]): string {
  let inner = ''
  if (row.attrs.cantSplit) inner += el('w:cantSplit')
  if (row.attrs.isHeader) inner += el('w:tblHeader')
  if (row.attrs.height != null) {
    inner += el('w:trHeight', {
      'w:val': row.attrs.height,
      'w:hRule': row.attrs.heightRule ?? undefined
    })
  }
  return inner ? wrap('w:trPr', undefined, inner) : ''
}

function writeCell(cell: TableCellNode, sections: Map<string, SectionProps>): string {
  const frags: OrderedFragment[] = []
  const add = (tag: string, xml: string): void => {
    if (xml) frags.push({ tag, xml })
  }

  if (cell.attrs.tcW) add('w:tcW', el('w:tcW', widthAttrs(cell.attrs.tcW)))
  if (cell.attrs.colspan > 1) add('w:gridSpan', valEl('w:gridSpan', cell.attrs.colspan))
  // rowspan は読み込み時に畳んだので、書き出しでは restart / continue に展開し直す
  if (cell.attrs.rowspan > 1) add('w:vMerge', el('w:vMerge', { 'w:val': 'restart' }))
  else if (cell.attrs.rowspan === 0) add('w:vMerge', el('w:vMerge'))
  add('w:tcBorders', writeBorders('w:tcBorders', cell.attrs.borders))
  if (cell.attrs.shd) {
    add('w:shd', el('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': cell.attrs.shd }))
  }
  if (cell.attrs.vAlign !== 'top') add('w:vAlign', valEl('w:vAlign', cell.attrs.vAlign))
  for (const frag of splitFragments(cell.attrs.rawTcPr)) frags.push(frag)

  const tcPr = wrap('w:tcPr', undefined, emitOrdered(TCPR_ORDER, frags))
  const content = cell.content.map((b) => writeBlock(b, sections)).join('')
  // Word のセルは必ず段落で終わる必要がある
  const body = content || wrap('w:p', undefined, '')
  return wrap('w:tc', undefined, tcPr + body)
}

export function writeBlock(node: BlockNode, sections: Map<string, SectionProps>): string {
  switch (node.type) {
    case 'paragraph':
      return writeParagraph(node, sections)
    case 'table':
      return writeTable(node, sections)
    case 'pageBreak':
      return wrap('w:p', undefined, wrap('w:r', undefined, el('w:br', { 'w:type': 'page' })))
    case 'sectionBreak': {
      // 末尾のセクションは body 直下の w:sectPr として書く。ここでは何も出さず、
      // writeBody 側でまとめて処理する
      return ''
    }
    case 'rawBlock':
      return node.attrs.xml
  }
}

/**
 * w:body を組み立てる。
 * 最後の sectionBreak だけは body 直下の w:sectPr にする必要があるため特別扱いする。
 */
export function writeBody(doc: WowdDoc, sections: Map<string, SectionProps>): string {
  const blocks = doc.content
  let trailingSection: SectionProps | undefined

  const body = blocks
    .filter((b, i) => {
      if (i === blocks.length - 1 && b.type === 'sectionBreak') {
        trailingSection = sections.get(b.attrs.sectionId)
        return false
      }
      return true
    })
    .map((b) => writeBlock(b, sections))
    .join('')

  const tail = trailingSection ? writeSectionProps(trailingSection) : ''
  return wrap('w:body', undefined, body + tail)
}
