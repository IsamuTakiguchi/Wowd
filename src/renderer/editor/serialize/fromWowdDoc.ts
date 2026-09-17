import type { WowdDoc, BlockNode, InlineNode, ParagraphNode } from '@core/model/types'
import { headingLevelOf } from './headingStyle'

/** ProseMirror が受け取る JSON。WowdDoc とほぼ同型だが heading だけ形が違う */
export interface PMJson {
  type: string
  attrs?: Record<string, unknown>
  content?: PMJson[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/**
 * WowdDoc を ProseMirror JSON に変換する。
 * 変換はヘディングの写像だけで、それ以外は同型なのでそのまま通す。
 */
export function fromWowdDoc(doc: WowdDoc): PMJson {
  return { type: 'doc', content: doc.content.map(blockToPM) }
}

function blockToPM(node: BlockNode): PMJson {
  switch (node.type) {
    case 'paragraph':
      return paragraphToPM(node)
    case 'table':
      return {
        type: 'table',
        attrs: { ...node.attrs },
        content: node.content.map((row) => ({
          type: 'tableRow',
          attrs: { ...row.attrs },
          content: row.content.map((cell) => ({
            type: 'tableCell',
            attrs: { ...cell.attrs },
            content: cell.content.map(blockToPM)
          }))
        }))
      }
    default:
      return { type: node.type, attrs: { ...node.attrs } }
  }
}

function paragraphToPM(node: ParagraphNode): PMJson {
  const level = headingLevelOf(node.attrs.pStyle)
  const content = (node.content ?? []).map(inlineToPM)
  const attrs: Record<string, unknown> = { ...node.attrs }

  if (level != null) {
    attrs['level'] = level
    return { type: 'heading', attrs, ...(content.length ? { content } : {}) }
  }
  return { type: 'paragraph', attrs, ...(content.length ? { content } : {}) }
}

function inlineToPM(node: InlineNode): PMJson {
  if (node.type === 'text') {
    return {
      type: 'text',
      text: node.text,
      ...(node.marks?.length
        ? {
            marks: node.marks.map((m) =>
              'attrs' in m
                ? { type: m.type, attrs: m.attrs as unknown as Record<string, unknown> }
                : { type: m.type }
            )
          }
        : {})
    }
  }
  if (node.type === 'ruby') {
    return { type: 'ruby', attrs: { ...node.attrs }, content: node.content.map(inlineToPM) }
  }
  return { type: node.type, attrs: { ...node.attrs } }
}
