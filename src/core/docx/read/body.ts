import type {
  BlockNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  TableWidth,
  Borders,
  BorderSide,
  Margins,
  SectionProps,
  Justification
} from '../../model/types'
import {
  type XNode,
  tagOf,
  childrenOf,
  attr,
  valOf,
  intAttr,
  boolVal,
  findChild,
  findChildren,
  serializeChildren
} from '../xml'
import { readParagraph } from './paragraph'
import type { RunContext } from './run'
import { readSection } from './section'

export interface ReadBodyResult {
  blocks: BlockNode[]
  sections: SectionProps[]
  /** w:body 直下の w:sectPr の id。段落が持つ途中のセクション区切りとは別物 */
  trailingSectionId: string | null
}

/**
 * w:body を走査してブロック列とセクション定義を取り出す。
 *
 * セクションは段落の pPr の中 (途中のセクション区切り) と body 末尾の 2 箇所に現れる。
 * 本体には ID 参照だけを残し、実体は WowdResources.sections に置く。
 */
export function readBody(body: XNode, ctx: RunContext): ReadBodyResult {
  const blocks: BlockNode[] = []
  const sections: SectionProps[] = []
  let trailingSectionId: string | null = null

  const addSection = (node: XNode): string => {
    const id = `sect${sections.length + 1}`
    sections.push(readSection(node, id))
    return id
  }

  for (const child of childrenOf(body)) {
    const tag = tagOf(child)
    switch (tag) {
      case 'w:p': {
        const { node, sectPr } = readParagraph(child, ctx)
        if (sectPr) {
          const id = addSection(sectPr)
          node.attrs.sectionId = id
        }
        blocks.push(node)
        break
      }
      case 'w:tbl':
        blocks.push(readTable(child, ctx))
        break
      case 'w:sectPr':
        // 文書全体の最後のセクション。Word は区切り記号を出さないので
        // 本文ツリーには入れず、書き出し時に body 末尾へ戻す
        trailingSectionId = addSection(child)
        break
      case 'w:bookmarkStart':
      case 'w:bookmarkEnd':
      case 'w:proofErr':
        break
      default:
        ctx.unsupported.add(tag)
        blocks.push({
          type: 'rawBlock',
          attrs: { xml: serializeChildren([child]) ?? '', label: tag }
        })
    }
  }

  return { blocks, sections, trailingSectionId }
}

function readTableWidth(node: XNode | undefined): TableWidth | null {
  if (!node) return null
  const value = intAttr(node, 'w:w') ?? 0
  const type = attr(node, 'w:type') ?? 'dxa'
  const known: TableWidth['type'][] = ['auto', 'dxa', 'pct', 'nil']
  return { value, type: known.includes(type as TableWidth['type']) ? (type as TableWidth['type']) : 'dxa' }
}

const BORDER_SIDES = ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'] as const

function readBorders(node: XNode | undefined): Borders | null {
  if (!node) return null
  const out: Borders = {}
  for (const side of BORDER_SIDES) {
    const el = findChild(node, `w:${side}`)
    if (!el) continue
    const border: BorderSide = {
      val: valOf(el) ?? 'single',
      sz: intAttr(el, 'w:sz') ?? 4,
      color: attr(el, 'w:color') ?? 'auto',
      space: intAttr(el, 'w:space') ?? 0
    }
    out[side] = border
  }
  return Object.keys(out).length ? out : null
}

function readMargins(node: XNode | undefined): Margins | null {
  if (!node) return null
  const out: Margins = {}
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const el = findChild(node, `w:${side}`)
    const v = intAttr(el, 'w:w')
    if (v != null) out[side] = v
  }
  return Object.keys(out).length ? out : null
}

const KNOWN_TBLPR = new Set([
  'w:tblStyle',
  'w:tblW',
  'w:jc',
  'w:tblBorders',
  'w:tblCellMar',
  'w:tblLayout'
])

export function readTable(tbl: XNode, ctx: RunContext): TableNode {
  const tblPr = findChild(tbl, 'w:tblPr')
  const leftovers: XNode[] = []
  if (tblPr) {
    for (const c of childrenOf(tblPr)) if (!KNOWN_TBLPR.has(tagOf(c))) leftovers.push(c)
  }

  const grid = findChildren(findChild(tbl, 'w:tblGrid'), 'w:gridCol').map(
    (g) => intAttr(g, 'w:w') ?? 0
  )

  const rows = findChildren(tbl, 'w:tr').map((tr) => readRow(tr, ctx))
  resolveVerticalMerge(rows)

  return {
    type: 'table',
    attrs: {
      tblStyle: valOf(findChild(tblPr, 'w:tblStyle')) ?? null,
      tblW: readTableWidth(findChild(tblPr, 'w:tblW')),
      jc: (valOf(findChild(tblPr, 'w:jc')) as Justification | undefined) ?? null,
      grid,
      borders: readBorders(findChild(tblPr, 'w:tblBorders')),
      cellMar: readMargins(findChild(tblPr, 'w:tblCellMar')),
      layout: valOf(findChild(tblPr, 'w:tblLayout')) === 'fixed' ? 'fixed' : 'autofit',
      rawTblPr: serializeChildren(leftovers)
    },
    content: rows
  }
}

/** vMerge の continue セルを数えて、開始セルの rowspan に畳む */
function resolveVerticalMerge(rows: TableRowNode[]): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    for (let c = 0; c < row.content.length; c++) {
      const cell = row.content[c]!
      if (cell.attrs.rowspan !== -1) continue
      // -1 は「vMerge=restart」の目印。下方向に continue を数える
      let span = 1
      for (let r2 = r + 1; r2 < rows.length; r2++) {
        const below = rows[r2]?.content[c]
        if (!below || below.attrs.rowspan !== -2) break
        span++
      }
      cell.attrs.rowspan = span
    }
  }
  // 残った continue セル (-2) は結合先に吸収されたので 0 にする
  for (const row of rows) {
    for (const cell of row.content) {
      if (cell.attrs.rowspan < 0) cell.attrs.rowspan = 0
    }
  }
}

function readRow(tr: XNode, ctx: RunContext): TableRowNode {
  const trPr = findChild(tr, 'w:trPr')
  const heightEl = findChild(trPr, 'w:trHeight')
  const heightRule = attr(heightEl, 'w:hRule')
  return {
    type: 'tableRow',
    attrs: {
      isHeader: findChild(trPr, 'w:tblHeader') !== undefined,
      height: intAttr(heightEl, 'w:val'),
      heightRule:
        heightRule === 'exact' || heightRule === 'atLeast' || heightRule === 'auto'
          ? heightRule
          : null,
      cantSplit: boolVal(findChild(trPr, 'w:cantSplit')),
      rawTrPr: null
    },
    content: findChildren(tr, 'w:tc').map((tc) => readCell(tc, ctx))
  }
}

const KNOWN_TCPR = new Set([
  'w:tcW',
  'w:gridSpan',
  'w:vMerge',
  'w:vAlign',
  'w:tcBorders',
  'w:shd'
])

function readCell(tc: XNode, ctx: RunContext): TableCellNode {
  const tcPr = findChild(tc, 'w:tcPr')
  const leftovers: XNode[] = []
  if (tcPr) {
    for (const c of childrenOf(tcPr)) if (!KNOWN_TCPR.has(tagOf(c))) leftovers.push(c)
  }

  const vMerge = findChild(tcPr, 'w:vMerge')
  // 実際の rowspan は表全体を見ないと決まらないので、いったん目印を入れる
  let rowspan = 1
  if (vMerge) rowspan = (valOf(vMerge) ?? 'continue') === 'restart' ? -1 : -2

  const vAlignVal = valOf(findChild(tcPr, 'w:vAlign'))

  const content: BlockNode[] = []
  for (const child of childrenOf(tc)) {
    const tag = tagOf(child)
    if (tag === 'w:p') content.push(readParagraph(child, ctx).node)
    else if (tag === 'w:tbl') content.push(readTable(child, ctx))
  }
  // Word のセルは必ず 1 つ以上の段落を含む
  if (content.length === 0) {
    content.push(readParagraph({ 'w:p': [] } as XNode, ctx).node)
  }

  return {
    type: 'tableCell',
    attrs: {
      colspan: intAttr(findChild(tcPr, 'w:gridSpan'), 'w:val') ?? 1,
      rowspan,
      tcW: readTableWidth(findChild(tcPr, 'w:tcW')),
      vAlign: vAlignVal === 'center' || vAlignVal === 'bottom' ? vAlignVal : 'top',
      borders: readBorders(findChild(tcPr, 'w:tcBorders')),
      shd: attr(findChild(tcPr, 'w:shd'), 'w:fill') ?? null,
      rawTcPr: serializeChildren(leftovers)
    },
    content
  }
}
