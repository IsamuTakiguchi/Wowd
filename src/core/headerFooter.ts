import type { WowdDoc, BlockNode, InlineNode, Justification } from './model/types'
import { EMPTY_PARAGRAPH_ATTRS } from './docx/read/paragraph'

/**
 * ヘッダー / フッターの簡易編集。
 *
 * ヘッダーの中身は本文と同じ「ブロックの並び」なので、原理上は何でも入る。
 * ただし実際のヘッダーはほぼ「1〜2 行の文字列とページ番号」なので、
 * 平文 + 差し込みトークンという形で扱えるようにする。
 *
 * 表や画像を含む凝ったヘッダーは平文にできないので、
 * そういうものは編集させない (`toEditableText` が null を返す)。
 * 無理に平文へ潰すと、開いて保存しただけでヘッダーの中身が消えてしまう。
 */

/** 本文中でページ番号を表す目印。実体は PAGE フィールド */
export const PAGE_TOKEN = '{ページ番号}'
/** 総ページ数 */
export const PAGES_TOKEN = '{総ページ数}'
/** タブ (中央寄せ・右寄せの区切りに使う) */
export const TAB_TOKEN = '{タブ}'

export interface EditableHeaderFooter {
  /** 1 行 1 段落。ページ番号などはトークンで表す */
  text: string
  /** 段落の配置。全段落で同じ場合だけ値が入る */
  jc: Justification | null
}

function fieldToken(instr: string): string | null {
  if (/\bNUMPAGES\b/.test(instr)) return PAGES_TOKEN
  if (/\bPAGE\b/.test(instr)) return PAGE_TOKEN
  return null
}

/**
 * 平文に落とせるかを見て、落とせるなら落とす。
 *
 * @returns 平文にできなければ null (凝ったヘッダーなので編集させない)
 */
export function toEditableText(doc: WowdDoc | null): EditableHeaderFooter | null {
  if (!doc) return { text: '', jc: null }

  const lines: string[] = []
  const alignments = new Set<Justification | null>()

  for (const block of doc.content) {
    if (block.type !== 'paragraph') return null
    alignments.add(block.attrs.jc)

    let line = ''
    for (const node of block.content ?? []) {
      switch (node.type) {
        case 'text':
          line += node.text
          break
        case 'wTab':
          line += TAB_TOKEN
          break
        case 'field': {
          const token = fieldToken(node.attrs.instr)
          // 知らないフィールドがあるなら平文にできない
          if (!token) return null
          line += token
          break
        }
        case 'bookmark':
          // 目印だけで見た目には出ない。落としても害はない
          break
        default:
          return null
      }
    }
    lines.push(line)
  }

  return {
    text: lines.join('\n'),
    jc: alignments.size === 1 ? ([...alignments][0] ?? null) : null
  }
}

/** 平文から、ヘッダー / フッターの中身を組み立てる */
export function fromEditableText(text: string, jc: Justification | null): WowdDoc {
  const content: BlockNode[] = text.split(/\r?\n/).map((line) => ({
    type: 'paragraph',
    attrs: { ...EMPTY_PARAGRAPH_ATTRS, jc },
    content: inlineFrom(line)
  }))
  // 完全に空でも段落を 1 つ残す。Word は中身の無いヘッダーを嫌う
  return { type: 'doc', content: content.length > 0 ? content : [emptyParagraph(jc)] }
}

function emptyParagraph(jc: Justification | null): BlockNode {
  return { type: 'paragraph', attrs: { ...EMPTY_PARAGRAPH_ATTRS, jc }, content: [] }
}

/** トークンを含む 1 行をインラインの並びにする */
function inlineFrom(line: string): InlineNode[] {
  const out: InlineNode[] = []
  const pattern = new RegExp(
    `${escapeRe(PAGE_TOKEN)}|${escapeRe(PAGES_TOKEN)}|${escapeRe(TAB_TOKEN)}`,
    'g'
  )

  let last = 0
  for (const match of line.matchAll(pattern)) {
    const at = match.index
    if (at > last) out.push({ type: 'text', text: line.slice(last, at) })
    out.push(tokenNode(match[0]))
    last = at + match[0].length
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) })
  return out
}

function tokenNode(token: string): InlineNode {
  if (token === TAB_TOKEN) return { type: 'wTab', attrs: {} }
  const instr = token === PAGES_TOKEN ? ' NUMPAGES  \\* MERGEFORMAT ' : ' PAGE  \\* MERGEFORMAT '
  // 値は Word に計算させる。こちらのページ分割は Word と一致しない
  return { type: 'field', attrs: { instr, cachedText: '', dirty: true } }
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
