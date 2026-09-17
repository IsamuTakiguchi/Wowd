import type {
  WowdDoc,
  BlockNode,
  InlineNode,
  TextNode,
  Mark,
  ParagraphAttrs,
  TableNode,
  TableRowNode,
  TableCellNode
} from '@core/model/types'
import { DEFAULT_PARAGRAPH_ATTRS } from '../extensions/paragraphAttrs'
import { headingStyleId } from './headingStyle'
import { restoreMergeContinuations } from './tableGrid'
import type { PMJson } from './fromWowdDoc'

/**
 * ProseMirror JSON を WowdDoc に戻す。
 * heading → pStyle 付き段落の写像以外は同型なのでそのまま通す。
 */
export function toWowdDoc(json: PMJson): WowdDoc {
  return { type: 'doc', content: (json.content ?? []).map(blockFromPM).filter(isBlock) }
}

function isBlock(n: BlockNode | null): n is BlockNode {
  return n !== null
}

function paragraphAttrsFrom(attrs: Record<string, unknown> | undefined): ParagraphAttrs {
  const out: ParagraphAttrs = { ...DEFAULT_PARAGRAPH_ATTRS }
  if (!attrs) return out
  for (const key of Object.keys(DEFAULT_PARAGRAPH_ATTRS) as (keyof ParagraphAttrs)[]) {
    const v = attrs[key]
    if (v !== undefined) (out as unknown as Record<string, unknown>)[key] = v
  }
  return out
}

function blockFromPM(node: PMJson): BlockNode | null {
  switch (node.type) {
    case 'paragraph': {
      const attrs = paragraphAttrsFrom(node.attrs)
      const content = (node.content ?? []).map(inlineFromPM).filter(isInline)
      return { type: 'paragraph', attrs, ...(content.length ? { content } : {}) }
    }
    case 'heading': {
      const attrs = paragraphAttrsFrom(node.attrs)
      const level = Number(node.attrs?.['level'] ?? 1)
      // Word 側の真実は pStyle。level は PM 側の都合なので落とす
      attrs.pStyle = headingStyleId(level)
      if (attrs.outlineLvl == null) attrs.outlineLvl = level - 1
      const content = (node.content ?? []).map(inlineFromPM).filter(isInline)
      return { type: 'paragraph', attrs, ...(content.length ? { content } : {}) }
    }
    case 'table':
      return tableFromPM(node)
    case 'pageBreak':
      return { type: 'pageBreak', attrs: {} }
    case 'sectionBreak':
      return { type: 'sectionBreak', attrs: { sectionId: String(node.attrs?.['sectionId'] ?? '') } }
    case 'rawBlock':
      return {
        type: 'rawBlock',
        attrs: { xml: String(node.attrs?.['xml'] ?? ''), label: String(node.attrs?.['label'] ?? '') }
      }
    default:
      return null
  }
}

function tableFromPM(node: PMJson): TableNode {
  const rows: TableRowNode[] = (node.content ?? []).map((row) => ({
    type: 'tableRow',
    attrs: (row.attrs ?? {}) as TableRowNode['attrs'],
    content: (row.content ?? []).map(
      (cell): TableCellNode => ({
        type: 'tableCell',
        attrs: (cell.attrs ?? {}) as TableCellNode['attrs'],
        content: (cell.content ?? []).map(blockFromPM).filter(isBlock)
      })
    )
  }))
  const attrs = (node.attrs ?? {}) as TableNode['attrs']
  // OOXML は縦結合の継続セルを各行に明示する必要がある
  return { type: 'table', attrs, content: restoreMergeContinuations(rows, attrs.grid ?? []) }
}

function isInline(n: InlineNode | null): n is InlineNode {
  return n !== null
}

function inlineFromPM(node: PMJson): InlineNode | null {
  if (node.type === 'text') {
    const text: TextNode = { type: 'text', text: node.text ?? '' }
    if (node.marks?.length) {
      text.marks = node.marks.map((m) => ({ type: m.type, attrs: m.attrs }) as unknown as Mark)
    }
    return text
  }
  if (node.type === 'ruby') {
    return {
      type: 'ruby',
      attrs: (node.attrs ?? {}) as Extract<InlineNode, { type: 'ruby' }>['attrs'],
      content: (node.content ?? [])
        .map(inlineFromPM)
        .filter((n): n is TextNode => n !== null && n.type === 'text')
    }
  }
  switch (node.type) {
    case 'wTab':
      return { type: 'wTab', attrs: {} }
    case 'wBreak':
    case 'field':
    case 'bookmark':
    case 'image':
    case 'rawRun':
      return { type: node.type, attrs: (node.attrs ?? {}) as never } as InlineNode
    default:
      return null
  }
}
