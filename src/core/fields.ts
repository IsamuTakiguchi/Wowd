/**
 * Word のフィールド命令の解釈。
 *
 * フィールドはキャッシュ済みの結果を持つ小さな言語なので、平テキストに潰すと
 * 不可逆になる。ここでは「Wowd が自分で計算できる」少数のフィールドだけを
 * 解決し、それ以外はキャッシュされた文字列をそのまま表示する。
 * 知らないフィールドを勝手に計算し直さないのが方針。
 */
import { formatNumber } from './numbering/format'

export interface FieldContext {
  /** 1 始まりの表示ページ番号 (pgNumType.start を反映済み) */
  pageNumber: number
  /** 文書全体のページ数 */
  pageCount: number
  /** w:pgNumType/@w:fmt。無指定なら decimal */
  pageNumberFormat: string
  /** ブックマーク名 → そのブックマークがあるページ番号 */
  bookmarkPages?: Map<string, number>
}

export interface ParsedField {
  /** 命令名 (大文字化済み)。例: 'PAGE' */
  name: string
  /** 命令名を除いた引数列 */
  args: string[]
  /** スイッチ (\* MERGEFORMAT など) */
  switches: string[]
}

/**
 * フィールド命令を分解する。
 * 引用符で囲まれた引数は 1 つとして扱う (TOC \o "1-3" のため)。
 */
export function parseFieldInstruction(instr: string): ParsedField {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false

  for (const ch of instr.trim()) {
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)

  const name = (tokens.shift() ?? '').toUpperCase()
  const args: string[] = []
  const switches: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.startsWith('\\')) {
      // スイッチは値を伴うことがある (\o "1-3")
      const next = tokens[i + 1]
      if (next && !next.startsWith('\\')) {
        switches.push(`${token} ${next}`)
        i++
      } else {
        switches.push(token)
      }
      continue
    }
    args.push(token)
  }

  return { name, args, switches }
}

/**
 * フィールドを解決する。
 * 計算できないものは null を返し、呼び出し側はキャッシュ値を使う。
 */
export function resolveField(instr: string, context: FieldContext): string | null {
  const field = parseFieldInstruction(instr)

  switch (field.name) {
    case 'PAGE':
      return formatNumber(context.pageNumber, formatOf(field, context.pageNumberFormat))
    case 'NUMPAGES':
      return formatNumber(context.pageCount, formatOf(field, context.pageNumberFormat))
    case 'SECTIONPAGES':
      // セクション単位のページ数。単一セクションなら全体と同じ
      return formatNumber(context.pageCount, formatOf(field, context.pageNumberFormat))
    case 'PAGEREF': {
      const name = field.args[0]
      if (!name) return null
      const page = context.bookmarkPages?.get(name)
      return page != null ? formatNumber(page, 'decimal') : null
    }
    default:
      // DATE や TOC など、勝手に計算し直すと内容が変わるものは触らない
      return null
  }
}

/**
 * `\* roman` のような書式スイッチを読む。
 * 指定が無ければセクションの pgNumType/@fmt に従う。
 */
function formatOf(field: ParsedField, fallback: string): string {
  for (const sw of field.switches) {
    const m = /^\\\*\s+(\S+)/.exec(sw)
    const value = m?.[1]?.toLowerCase()
    if (!value) continue
    switch (value) {
      case 'roman':
        return 'lowerRoman'
      case 'arabic':
        return 'decimal'
      case 'alphabetic':
        return 'lowerLetter'
      case 'mergeformat':
      case 'charformat':
        // 書式を引き継ぐ指定であって番号書式ではない
        continue
      default:
        continue
    }
  }
  return fallback || 'decimal'
}

/** フィールドが Wowd 側で計算できる種類か */
export function isResolvableField(instr: string): boolean {
  const { name } = parseFieldInstruction(instr)
  return name === 'PAGE' || name === 'NUMPAGES' || name === 'SECTIONPAGES' || name === 'PAGEREF'
}
