import type { Mark, RunProps, RunFonts, InlineNode, TextNode, RevisionMeta } from '../../model/types'
import {
  type XNode,
  tagOf,
  childrenOf,
  attr,
  valOf,
  textOf,
  boolVal,
  intVal,
  findChild,
  serializeChildren
} from '../xml'

/** モデル化済みの w:rPr 子要素。ここに無いものは rawRPr へ退避する */
const KNOWN_RPR = new Set([
  'w:rFonts',
  'w:b',
  'w:bCs',
  'w:i',
  'w:iCs',
  'w:u',
  'w:strike',
  'w:dstrike',
  'w:color',
  'w:sz',
  'w:szCs',
  'w:highlight',
  'w:shd',
  'w:spacing',
  'w:w',
  'w:kern',
  'w:vertAlign',
  'w:rStyle',
  'w:lang'
])

export const EMPTY_RUN_PROPS: RunProps = {
  rFonts: null,
  sz: null,
  szCs: null,
  color: null,
  highlight: null,
  shd: null,
  spacing: null,
  w: null,
  kern: null,
  vertAlign: null,
  rStyle: null,
  lang: null,
  rawRPr: null
}

function readFonts(node: XNode): RunFonts {
  const out: RunFonts = {}
  const pick = (name: string): string | undefined => attr(node, name)
  const ascii = pick('w:ascii')
  const eastAsia = pick('w:eastAsia')
  const hAnsi = pick('w:hAnsi')
  const cs = pick('w:cs')
  const hint = pick('w:hint')
  const asciiTheme = pick('w:asciiTheme')
  const eastAsiaTheme = pick('w:eastAsiaTheme')
  const hAnsiTheme = pick('w:hAnsiTheme')
  if (ascii) out.ascii = ascii
  if (eastAsia) out.eastAsia = eastAsia
  if (hAnsi) out.hAnsi = hAnsi
  if (cs) out.cs = cs
  if (hint === 'default' || hint === 'eastAsia' || hint === 'cs') out.hint = hint
  if (asciiTheme) out.asciiTheme = asciiTheme
  if (eastAsiaTheme) out.eastAsiaTheme = eastAsiaTheme
  if (hAnsiTheme) out.hAnsiTheme = hAnsiTheme
  return out
}

export interface ParsedRunProps {
  props: RunProps
  bold: boolean
  italic: boolean
  strike: boolean
  doubleStrike: boolean
  underline: { val: string; color: string | null } | null
}

export function readRunProps(rPr: XNode | undefined): ParsedRunProps {
  const props: RunProps = { ...EMPTY_RUN_PROPS }
  const result: ParsedRunProps = {
    props,
    bold: false,
    italic: false,
    strike: false,
    doubleStrike: false,
    underline: null
  }
  if (!rPr) return result

  const leftovers: XNode[] = []
  for (const child of childrenOf(rPr)) {
    const tag = tagOf(child)
    if (!KNOWN_RPR.has(tag)) {
      leftovers.push(child)
      continue
    }
    switch (tag) {
      case 'w:rFonts':
        props.rFonts = readFonts(child)
        break
      case 'w:b':
        result.bold = boolVal(child)
        break
      case 'w:i':
        result.italic = boolVal(child)
        break
      case 'w:strike':
        result.strike = boolVal(child)
        break
      case 'w:dstrike':
        result.doubleStrike = boolVal(child)
        break
      case 'w:u': {
        const val = valOf(child) ?? 'single'
        if (val !== 'none') result.underline = { val, color: attr(child, 'w:color') ?? null }
        break
      }
      case 'w:color':
        props.color = valOf(child) ?? null
        break
      case 'w:sz':
        props.sz = intVal(child)
        break
      case 'w:szCs':
        props.szCs = intVal(child)
        break
      case 'w:highlight':
        props.highlight = valOf(child) ?? null
        break
      case 'w:shd':
        props.shd = attr(child, 'w:fill') ?? null
        break
      case 'w:spacing':
        props.spacing = intVal(child)
        break
      case 'w:w':
        props.w = intVal(child)
        break
      case 'w:kern':
        props.kern = intVal(child)
        break
      case 'w:vertAlign': {
        const v = valOf(child)
        props.vertAlign = v === 'superscript' || v === 'subscript' ? v : null
        break
      }
      case 'w:rStyle':
        props.rStyle = valOf(child) ?? null
        break
      case 'w:lang': {
        const val = valOf(child)
        const ea = attr(child, 'w:eastAsia')
        if (val || ea) props.lang = { ...(val ? { val } : {}), ...(ea ? { eastAsia: ea } : {}) }
        break
      }
      // w:bCs / w:iCs は複合文字用。値は rawRPr でなく単純に無視せず往復させる
      case 'w:bCs':
      case 'w:iCs':
        leftovers.push(child)
        break
    }
  }
  props.rawRPr = serializeChildren(leftovers)
  return result
}

export function isEmptyRunProps(p: RunProps): boolean {
  return (Object.keys(EMPTY_RUN_PROPS) as (keyof RunProps)[]).every((k) => p[k] == null)
}

/** ParsedRunProps からマーク配列を組み立てる */
export function marksFrom(parsed: ParsedRunProps, extra: Mark[] = []): Mark[] {
  const marks: Mark[] = []
  if (parsed.bold) marks.push({ type: 'bold' })
  if (parsed.italic) marks.push({ type: 'italic' })
  if (parsed.underline) marks.push({ type: 'underline', attrs: parsed.underline })
  if (parsed.strike) marks.push({ type: 'strike' })
  if (parsed.doubleStrike) marks.push({ type: 'doubleStrike' })
  if (!isEmptyRunProps(parsed.props)) marks.push({ type: 'textStyle', attrs: parsed.props })
  return [...marks, ...extra]
}

export interface RunContext {
  /** w:ins / w:del の中にいる場合の改訂情報 */
  revision: { kind: 'ins' | 'del'; meta: RevisionMeta } | null
  /** 有効なコメント ID (w:commentRangeStart 〜 End の内側) */
  commentIds: string[]
  /** 未対応要素のラベル収集先 */
  unsupported: Set<string>
}

/** モデル化済みの w:r 子要素 */
const KNOWN_RUN_CHILD = new Set([
  'w:rPr',
  'w:t',
  'w:delText',
  'w:tab',
  'w:br',
  'w:noBreakHyphen',
  'w:softHyphen',
  'w:cr',
  'w:ruby',
  'w:sym'
])

/** w:r を InlineNode 列に展開する */
export function readRun(run: XNode, ctx: RunContext): InlineNode[] {
  const parsed = readRunProps(findChild(run, 'w:rPr'))
  const extra: Mark[] = []
  if (ctx.commentIds.length > 0) extra.push({ type: 'comment', attrs: { ids: [...ctx.commentIds] } })
  if (ctx.revision) {
    extra.push(
      ctx.revision.kind === 'ins'
        ? { type: 'insertion', attrs: ctx.revision.meta }
        : { type: 'deletion', attrs: ctx.revision.meta }
    )
  }
  const marks = marksFrom(parsed, extra)

  const out: InlineNode[] = []
  const pushText = (text: string): void => {
    if (text.length === 0) return
    const node: TextNode = { type: 'text', text }
    if (marks.length) node.marks = marks
    out.push(node)
  }

  for (const child of childrenOf(run)) {
    const tag = tagOf(child)
    switch (tag) {
      case 'w:rPr':
        break
      case 'w:t':
      case 'w:delText':
        pushText(textOf(child))
        break
      case 'w:tab':
        out.push({ type: 'wTab', attrs: {} })
        break
      case 'w:cr':
        out.push({ type: 'wBreak', attrs: { breakType: 'textWrapping', clear: null } })
        break
      case 'w:br': {
        const type = attr(child, 'w:type')
        if (type === 'page') {
          // 段落内の改ページは独立ブロックに昇格できないので、ここでは改行として扱い、
          // 元の XML は rawRun で保持する
          out.push({ type: 'rawRun', attrs: { xml: '', label: '改ページ' } })
        } else {
          out.push({
            type: 'wBreak',
            attrs: {
              breakType: type === 'column' ? 'column' : 'textWrapping',
              clear: attr(child, 'w:clear') ?? null
            }
          })
        }
        break
      }
      case 'w:noBreakHyphen':
        pushText('‑')
        break
      case 'w:softHyphen':
        pushText('­')
        break
      case 'w:sym':
        pushText(symbolChar(child))
        break
      default:
        if (!KNOWN_RUN_CHILD.has(tag)) {
          ctx.unsupported.add(tag)
          out.push({ type: 'rawRun', attrs: { xml: serializeChildren([child]) ?? '', label: tag } })
        }
    }
  }
  return out
}

function symbolChar(node: XNode): string {
  const charHex = attr(node, 'w:char')
  if (!charHex) return ''
  const code = Number.parseInt(charHex, 16)
  if (!Number.isFinite(code)) return ''
  // シンボルフォントの私用領域 (F0xx) は対応する ASCII に寄せる
  return String.fromCodePoint(code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code)
}

export function readRevisionMeta(node: XNode): RevisionMeta {
  return {
    id: Number(attr(node, 'w:id') ?? 0) || 0,
    author: attr(node, 'w:author') ?? '',
    date: attr(node, 'w:date') ?? ''
  }
}
