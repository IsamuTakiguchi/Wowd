/**
 * 目次の生成。
 *
 * Word の目次は「TOC フィールド」と「計算済みの中身」の組で表される。
 * 中身はハイパーリンクつきの段落の並びで、各行に PAGEREF フィールドが入る。
 *
 * ここでは中身も一緒に作る。作らないと Word で開くまで目次が空のままになる。
 * ページ番号はページ分割の結果から渡してもらう (core は DOM を知らないため)。
 */
import type { WowdDoc, BlockNode, ParagraphNode, InlineNode } from './model/types'
import { EMPTY_PARAGRAPH_ATTRS } from './docx/read/paragraph'

export interface TocEntry {
  /** 1 始まりの見出しレベル */
  level: number
  text: string
  /** PAGEREF が指すブックマーク名 */
  bookmark: string
  /** 本文中のブロック番号 */
  blockIndex: number
  /** 表示するページ番号。分からなければ null */
  page: number | null
}

export interface TocOptions {
  /** 目次に入れる見出しの範囲 */
  minLevel?: number
  maxLevel?: number
  /** ブロック番号 → ページ番号 */
  pageOf?: (blockIndex: number) => number | null
}

/** 見出しスタイル名から段落のレベルを求める。outlineLvl があればそちらを優先する */
export function headingLevelOf(block: BlockNode): number | null {
  if (block.type !== 'paragraph') return null
  if (block.attrs.outlineLvl != null && block.attrs.outlineLvl <= 8) {
    return block.attrs.outlineLvl + 1
  }
  const m = /^Heading([1-9])$/.exec(block.attrs.pStyle ?? '')
  return m ? Number(m[1]) : null
}

/** 段落の可視テキスト */
function textOf(block: ParagraphNode): string {
  let out = ''
  for (const node of block.content ?? []) {
    if (node.type === 'text') out += node.text
    else if (node.type === 'ruby') out += node.content.map((t) => t.text).join('')
    else if (node.type === 'wTab') out += ' '
  }
  return out.trim()
}

/** 文書から見出しを集める */
export function collectHeadings(doc: WowdDoc, options: TocOptions = {}): TocEntry[] {
  const min = options.minLevel ?? 1
  const max = options.maxLevel ?? 3
  const entries: TocEntry[] = []

  doc.content.forEach((block, blockIndex) => {
    const level = headingLevelOf(block)
    if (level == null || level < min || level > max) return
    if (block.type !== 'paragraph') return
    const text = textOf(block)
    if (text.length === 0) return

    entries.push({
      level,
      text,
      // Word と同じ命名にしておくと、Word 側で更新しても衝突しない
      bookmark: `_Toc${900000000 + entries.length}`,
      blockIndex,
      page: options.pageOf?.(blockIndex) ?? null
    })
  })

  return entries
}

/**
 * 見出しにブックマークを付ける。
 * PAGEREF はブックマークを指すので、これが無いと目次のページ番号が出ない。
 */
export function withTocBookmarks(doc: WowdDoc, entries: TocEntry[]): WowdDoc {
  const byIndex = new Map(entries.map((e) => [e.blockIndex, e]))

  return {
    type: 'doc',
    content: doc.content.map((block, index) => {
      const entry = byIndex.get(index)
      if (!entry || block.type !== 'paragraph') return block

      // すでに同じブックマークが付いていれば足さない
      const existing = (block.content ?? []).some(
        (n) => n.type === 'bookmark' && n.attrs.name === entry.bookmark
      )
      if (existing) return block

      const content: InlineNode[] = [
        { type: 'bookmark', attrs: { id: String(index + 1), name: entry.bookmark, isEnd: false } },
        ...(block.content ?? []),
        { type: 'bookmark', attrs: { id: String(index + 1), name: '', isEnd: true } }
      ]
      return { ...block, content }
    })
  }
}

/** 目次の見出し。Word の既定に合わせる */
export const TOC_TITLE = '目次'

/** TOC フィールドの命令文字列 */
export function tocInstruction(minLevel = 1, maxLevel = 3): string {
  // \o 見出しレベルの範囲 / \h ハイパーリンクにする / \z Web 表示で番号を隠す / \u アウトラインレベルを使う
  return ` TOC \\o "${minLevel}-${maxLevel}" \\h \\z \\u `
}

/**
 * 目次のブロック列を作る。
 *
 * 先頭が TOC フィールドで、その後ろに計算済みの各行が並ぶ。
 * Word はこの形をそのまま目次として認識し、「目次の更新」で作り直せる。
 */
export function buildToc(entries: TocEntry[], minLevel = 1, maxLevel = 3): BlockNode[] {
  const field: ParagraphNode = {
    type: 'paragraph',
    attrs: { ...EMPTY_PARAGRAPH_ATTRS, pStyle: 'TOCHeading' },
    content: [
      { type: 'text', text: TOC_TITLE },
      {
        type: 'field',
        attrs: {
          instr: tocInstruction(minLevel, maxLevel),
          cachedText: '',
          // Word に再計算させる。こちらの行分割は Word と一致しないので、
          // ページ番号を断定するより Word に計算させる方が正しい
          dirty: true
        }
      }
    ]
  }

  const lines: BlockNode[] = entries.map((entry): ParagraphNode => {
    const content: InlineNode[] = [
      {
        type: 'text',
        text: entry.text,
        // 見出しへのリンク。r:id ではなく文書内のブックマークを指す
        marks: [
          { type: 'link', attrs: { href: null, anchor: entry.bookmark, rId: null, tooltip: null } }
        ]
      },
      { type: 'wTab', attrs: {} },
      {
        type: 'field',
        attrs: {
          instr: ` PAGEREF ${entry.bookmark} \\h `,
          cachedText: entry.page != null ? String(entry.page) : '',
          dirty: true
        }
      }
    ]
    return {
      type: 'paragraph',
      attrs: {
        ...EMPTY_PARAGRAPH_ATTRS,
        pStyle: `TOC${entry.level}`,
        // レベルごとに字下げする。1 レベル 2 文字
        ind: { leftChars: (entry.level - 1) * 200 }
      },
      content
    }
  })

  return [field, ...lines]
}

/**
 * 既存の目次を探す。TOC フィールドを含む段落から、
 * 次の見出しまたは本文までが目次の範囲。
 *
 * @returns [開始, 終了) のブロック番号。無ければ null
 */
export function findExistingToc(doc: WowdDoc): [number, number] | null {
  const start = doc.content.findIndex(
    (block) =>
      block.type === 'paragraph' &&
      (block.content ?? []).some((n) => n.type === 'field' && /\bTOC\b/.test(n.attrs.instr))
  )
  if (start === -1) return null

  let end = start + 1
  while (end < doc.content.length) {
    const block = doc.content[end]
    if (block?.type !== 'paragraph') break
    // TOC スタイルが続く間が目次の中身
    if (!/^TOC\d?$/.test(block.attrs.pStyle ?? '')) break
    end++
  }
  return [start, end]
}

/** 目次を挿入または差し替えた文書を返す */
export function applyToc(
  doc: WowdDoc,
  entries: TocEntry[],
  insertAt: number,
  minLevel = 1,
  maxLevel = 3
): WowdDoc {
  const withBookmarks = withTocBookmarks(doc, entries)
  const toc = buildToc(entries, minLevel, maxLevel)
  const existing = findExistingToc(withBookmarks)

  if (existing) {
    const [start, end] = existing
    return {
      type: 'doc',
      content: [
        ...withBookmarks.content.slice(0, start),
        ...toc,
        ...withBookmarks.content.slice(end)
      ]
    }
  }

  const at = Math.max(0, Math.min(insertAt, withBookmarks.content.length))
  return {
    type: 'doc',
    content: [
      ...withBookmarks.content.slice(0, at),
      ...toc,
      ...withBookmarks.content.slice(at)
    ]
  }
}
