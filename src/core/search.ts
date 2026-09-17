/**
 * 文書全体に対する検索と置換。
 *
 * ProseMirror に依存せず WowdDoc の上で動く純粋関数として書く。
 * 日本語文書では「全角と半角」「ひらがなとカタカナ」を区別しない検索がほぼ必須なので、
 * 正規化を通したうえで元テキスト上の位置に対応づける。
 */
import type { WowdDoc, BlockNode, InlineNode } from './model/types'

export interface SearchOptions {
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
  /** 全角と半角を区別しない */
  normalizeWidth: boolean
  /** ひらがなとカタカナを区別しない */
  normalizeKana: boolean
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
  normalizeWidth: true,
  normalizeKana: false
}

export interface SearchMatch {
  /** 文書全体を連結したテキスト上の開始位置 */
  from: number
  /** 終了位置 (排他) */
  to: number
  text: string
}

/**
 * 文書のテキストを 1 本に連結する。
 * 段落の境目には改行を 1 文字入れ、位置がずれないようにする。
 */
export interface FlatText {
  text: string
  /** text の各文字が何番目のブロックに属するか */
  blockIndex: number[]
}

export function flattenDoc(doc: WowdDoc): FlatText {
  let text = ''
  const blockIndex: number[] = []

  const pushInline = (nodes: InlineNode[] | undefined, bi: number): void => {
    for (const node of nodes ?? []) {
      if (node.type === 'text') {
        for (const _ of node.text) blockIndex.push(bi)
        text += node.text
      } else if (node.type === 'ruby') {
        for (const child of node.content) {
          for (const _ of child.text) blockIndex.push(bi)
          text += child.text
        }
      } else if (node.type === 'wTab') {
        blockIndex.push(bi)
        text += '\t'
      }
    }
  }

  const walkBlock = (block: BlockNode, bi: number): void => {
    if (block.type === 'paragraph') pushInline(block.content, bi)
    else if (block.type === 'table') {
      for (const row of block.content) {
        for (const cell of row.content) {
          for (const inner of cell.content) walkBlock(inner, bi)
        }
      }
    }
  }

  doc.content.forEach((block, i) => {
    if (i > 0) {
      text += '\n'
      blockIndex.push(i)
    }
    walkBlock(block, i)
  })

  return { text, blockIndex }
}

/**
 * 半角カタカナ → 全角カタカナ。
 *
 * ｶ + ﾞ のような濁点付きは 2 文字なので、1 文字 1 文字の対応が崩れる。
 * 位置対応を守るため、ここでは清音の基本字だけを写し、濁点・半濁点はそのまま残す。
 * したがって「ｶﾞ」と「ガ」は一致しない。この制約は README と UI の説明に合わせてある。
 */
const HALFWIDTH_KATAKANA = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ'
const FULLWIDTH_KATAKANA = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'

const HALF_TO_FULL_KANA = new Map<string, string>()
for (let i = 0; i < HALFWIDTH_KATAKANA.length; i++) {
  HALF_TO_FULL_KANA.set(HALFWIDTH_KATAKANA[i]!, FULLWIDTH_KATAKANA[i]!)
}

/**
 * 文字単位の正規化。
 *
 * 1 文字が必ず 1 文字に写ることが重要で、そうでないと元テキストの位置とずれる。
 * 濁点を分解する NFKD を使わないのはそのため。
 */
export function normalizeChar(ch: string, options: SearchOptions): string {
  let c = ch

  if (options.normalizeWidth) {
    const code = c.codePointAt(0) ?? 0
    // 全角英数記号 (Ａ-Ｚ ０-９ など) → 半角
    if (code >= 0xff01 && code <= 0xff5e) c = String.fromCodePoint(code - 0xfee0)
    // 全角スペース → 半角スペース
    else if (code === 0x3000) c = ' '
    // 半角カタカナ → 全角カタカナ
    else {
      const full = HALF_TO_FULL_KANA.get(c)
      if (full) c = full
    }
  }

  if (options.normalizeKana) {
    const code = c.codePointAt(0) ?? 0
    // カタカナ (ァ-ヶ) → ひらがな。長音符とヷ〜ヺ は対応するひらがなが無いので触らない
    if (code >= 0x30a1 && code <= 0x30f6) c = String.fromCodePoint(code - 0x60)
  }

  if (!options.matchCase) c = c.toLowerCase()

  return c
}

export function normalizeText(text: string, options: SearchOptions): string {
  let out = ''
  for (const ch of text) out += normalizeChar(ch, options)
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 検索を実行して一致位置を返す。位置は元テキストの UTF-16 インデックス。
 *
 * 正規表現モードでは正規化を掛けない (パターンと文字位置の対応が崩れるため)。
 */
export function search(haystack: string, needle: string, options: SearchOptions): SearchMatch[] {
  if (needle.length === 0) return []

  if (options.regex) {
    const flags = options.matchCase ? 'gu' : 'giu'
    let re: RegExp
    try {
      re = new RegExp(needle, flags)
    } catch {
      return []
    }
    const out: SearchMatch[] = []
    for (const m of haystack.matchAll(re)) {
      if (m.index === undefined) continue
      if (m[0].length === 0) continue
      out.push({ from: m.index, to: m.index + m[0].length, text: m[0] })
    }
    return out
  }

  // 正規化は 1 文字 1 文字対応なので、正規化後の位置 = 元の位置
  const hay = normalizeText(haystack, options)
  const pat = normalizeText(needle, options)

  const pattern = options.wholeWord
    ? new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(pat)}(?![\\p{L}\\p{N}_])`, 'gu')
    : null

  const out: SearchMatch[] = []
  if (pattern) {
    for (const m of hay.matchAll(pattern)) {
      if (m.index === undefined) continue
      out.push({ from: m.index, to: m.index + pat.length, text: haystack.slice(m.index, m.index + pat.length) })
    }
    return out
  }

  let idx = hay.indexOf(pat)
  while (idx !== -1) {
    out.push({ from: idx, to: idx + pat.length, text: haystack.slice(idx, idx + pat.length) })
    idx = hay.indexOf(pat, idx + pat.length)
  }
  return out
}

/** 現在位置より後の最初の一致。無ければ先頭に戻る */
export function nextMatch(matches: SearchMatch[], cursor: number): SearchMatch | null {
  if (matches.length === 0) return null
  return matches.find((m) => m.from >= cursor) ?? matches[0] ?? null
}

/** 現在位置より前の最後の一致。無ければ末尾に戻る */
export function prevMatch(matches: SearchMatch[], cursor: number): SearchMatch | null {
  if (matches.length === 0) return null
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!
    if (m.to <= cursor) return m
  }
  return matches[matches.length - 1] ?? null
}
