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

/* ───────────── 表や画像を含むヘッダーの編集 ───────────── */

/**
 * 表や画像を含むヘッダーも、**文字だけは直せる**ようにする。
 *
 * 平文に潰す方式 (toEditableText) は、潰せない中身があると諦めるしかない。
 * 潰して書き戻せば表も画像も消えてしまうので、諦めるのは正しい。
 * だが社名入りのレターヘッドのように、**表や画像は触らず文字だけ直したい**
 * ことのほうが多い。
 *
 * そこで、段落ひとつひとつを「道筋 (path)」で指して、
 * その段落の中身だけを差し替える。表のセルの中の段落も指せる。
 * 触らなかったものは元のまま残るので、構造も画像も失われない。
 */
export interface EditableLine {
  /** ブロックの位置。表のセルの中なら [1, 0, 2, 0] のように深くなる */
  path: number[]
  /** いまの文字。ページ番号などはトークンで表す */
  text: string
  /**
   * 直せるか。
   *
   * 画像や未対応の要素を含む段落は、文字に落とすと中身が消えるので直せない。
   * **それでも一覧には出す。**出さないと、直せない段落があること自体が
   * 伝わらず「なぜか一部だけ直せない」に見える。
   */
  editable: boolean
  /** 表のセルの中にあるか。画面での見せ方を変える */
  inTable: boolean
}

/** 段落の中身をトークン混じりの平文にする。落とせなければ null */
function lineOf(block: BlockNode): string | null {
  if (block.type !== 'paragraph') return null
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
        if (!token) return null
        line += token
        break
      }
      case 'bookmark':
        break
      default:
        return null
    }
  }
  return line
}

function walkLines(blocks: BlockNode[], prefix: number[], inTable: boolean): EditableLine[] {
  const out: EditableLine[] = []
  blocks.forEach((block, index) => {
    const path = [...prefix, index]
    if (block.type === 'paragraph') {
      const text = lineOf(block)
      out.push({ path, text: text ?? '', editable: text !== null, inTable })
      return
    }
    if (block.type === 'table') {
      block.content.forEach((row, r) => {
        row.content.forEach((cell, c) => {
          out.push(...walkLines(cell.content, [...path, r, c], true))
        })
      })
    }
  })
  return out
}

/** 直せる段落を、道筋つきで列挙する */
export function editableLines(doc: WowdDoc | null): EditableLine[] {
  return doc ? walkLines(doc.content, [], false) : []
}

/** 表や画像を含むか (平文に潰せないか) */
export function isRich(doc: WowdDoc | null): boolean {
  return doc != null && toEditableText(doc) === null
}

function replaceAt(blocks: BlockNode[], path: number[], text: string): BlockNode[] {
  const [index, ...rest] = path
  if (index == null) return blocks
  return blocks.map((block, i) => {
    if (i !== index) return block
    if (rest.length === 0) {
      if (block.type !== 'paragraph') return block
      return { ...block, content: inlineFrom(text) }
    }
    if (block.type !== 'table') return block
    const [r, c, ...deeper] = rest
    if (r == null || c == null) return block
    return {
      ...block,
      content: block.content.map((row, ri) =>
        ri !== r
          ? row
          : {
              ...row,
              content: row.content.map((cell, ci) =>
                ci !== c ? cell : { ...cell, content: replaceAt(cell.content, deeper, text) }
              )
            }
      )
    }
  })
}

/**
 * 直した行を書き戻す。
 *
 * 触られなかった段落と、表・画像・未対応の要素はそのまま残る。
 * **道筋で指して差し替えるだけ**なので、構造は一切動かない。
 */
export function applyEditableLines(doc: WowdDoc, lines: EditableLine[]): WowdDoc {
  let content = doc.content
  for (const line of lines) {
    if (!line.editable) continue
    content = replaceAt(content, line.path, line.text)
  }
  return { ...doc, content }
}
