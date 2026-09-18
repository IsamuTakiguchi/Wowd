import type { WowdDoc, BlockNode, InlineNode, ParagraphNode, Mark } from '@core/model/types'
import { headingLevelOf } from './headingStyle'
import { stripMergeContinuations } from './tableGrid'

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
        // 縦結合の継続セルは ProseMirror の表モデルに存在しない。
        // 残すと列数が合わず、prosemirror-tables が勝手にセルを足す
        content: stripMergeContinuations(node).map((row) => ({
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

/**
 * マークの属性をスキーマの形に合わせる。
 *
 * **ProseMirror は宣言の無い属性を黙って捨てる。** モデルとスキーマで
 * 形が違うと、その属性は setContent の時点で消える。
 * textStyle だけ入れ子 (runProps 1 個) で宣言しているので、ここで包む。
 * 包み忘れると w:rFonts や w:sz が「開いて保存しただけ」で失われる。
 */
function markToPM(m: Mark): { type: string; attrs?: Record<string, unknown> } {
  if (m.type === 'textStyle') return { type: m.type, attrs: { runProps: m.attrs } }
  return 'attrs' in m
    ? { type: m.type, attrs: m.attrs as unknown as Record<string, unknown> }
    : { type: m.type }
}

function inlineToPM(node: InlineNode): PMJson {
  if (node.type === 'text') {
    return {
      type: 'text',
      text: node.text,
      ...(node.marks?.length ? { marks: node.marks.map(markToPM) } : {})
    }
  }
  if (node.type === 'ruby') {
    return { type: 'ruby', attrs: { ...node.attrs }, content: node.content.map(inlineToPM) }
  }
  return { type: node.type, attrs: { ...node.attrs } }
}
