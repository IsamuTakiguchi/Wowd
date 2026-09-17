/**
 * WML 用の XML 入出力。
 *
 * fast-xml-parser を preserveOrder: true で使う。これは必須で、
 * WML は兄弟要素の順序が意味を持つため (w:commentRangeStart が対象ランの前に来る、
 * w:ins が複数のランを包む、など) 既定のオブジェクトモードでは情報が壊れる。
 *
 * 書き出しは自前の小さなエミッタを使う。xmlbuilder2 は名前空間の扱いが
 * WML の固定プレフィックスと噛み合わず、必要のない機能が大きすぎる。
 */
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

export const ATTR_PREFIX = '@_'
export const TEXT_KEY = '#text'

/**
 * preserveOrder の出力形。1 要素が 1 オブジェクトで、
 * タグ名のキーに子ノードの配列、':@' に属性が入る。
 */
export interface XNode {
  [key: string]: XNode[] | string | number | boolean | XAttrs | undefined
  ':@'?: XAttrs
}

export type XAttrs = Record<string, string>

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  textNodeName: TEXT_KEY,
  // 空白は意味を持つ (xml:space="preserve")。絶対にトリムしない
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
  // 外部エンティティ展開は攻撃面なので使わない
  allowBooleanAttributes: true
})

const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  textNodeName: TEXT_KEY,
  suppressEmptyNode: true,
  processEntities: true
})

export function parseXml(xml: string): XNode[] {
  return parser.parse(xml) as XNode[]
}

/** preserveOrder のサブツリーを XML 文字列に戻す。raw 退避した断片の書き戻しに使う */
export function buildXml(nodes: XNode[]): string {
  return builder.build(nodes) as string
}

// ───────────────────────── ツリー走査ヘルパ ─────────────────────────

/** ノードのタグ名を返す (':@' と '#text' 以外の唯一のキー) */
export function tagOf(node: XNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== TEXT_KEY) return key
  }
  return TEXT_KEY in node ? TEXT_KEY : ''
}

export function childrenOf(node: XNode): XNode[] {
  const tag = tagOf(node)
  const v = node[tag]
  return Array.isArray(v) ? v : []
}

export function attrsOf(node: XNode | undefined): XAttrs {
  return node?.[':@'] ?? {}
}

export function attr(node: XNode | undefined, name: string): string | undefined {
  return attrsOf(node)[ATTR_PREFIX + name]
}

/** w:val 属性。WML の大半の要素は値をここに持つ */
export function valOf(node: XNode | undefined): string | undefined {
  return attr(node, 'w:val')
}

/**
 * 要素のテキストを取り出す。
 *
 * preserveOrder モードではテキストは要素自身のキーではなく、
 * 子として {'#text': '...'} の形で入る。w:t のように子が複数に割れることもあるので連結する。
 */
export function textOf(node: XNode): string {
  const direct = node[TEXT_KEY]
  if (typeof direct === 'string') return direct
  let out = ''
  for (const child of childrenOf(node)) {
    const v = child[TEXT_KEY]
    if (typeof v === 'string') out += v
    else if (typeof v === 'number' || typeof v === 'boolean') out += String(v)
  }
  return out
}

export function findChild(node: XNode | undefined, tag: string): XNode | undefined {
  return node ? childrenOf(node).find((c) => tagOf(c) === tag) : undefined
}

export function findChildren(node: XNode | undefined, tag: string): XNode[] {
  return node ? childrenOf(node).filter((c) => tagOf(c) === tag) : []
}

/**
 * w:b や w:keepNext のような「存在すれば真、w:val="0" なら偽」のフラグを読む。
 * w:val 省略時は true。
 */
export function boolVal(node: XNode | undefined): boolean {
  if (!node) return false
  const v = valOf(node)
  if (v === undefined) return true
  return v !== '0' && v !== 'false' && v !== 'off'
}

export function intVal(node: XNode | undefined, fallback: number | null = null): number | null {
  if (!node) return fallback
  const v = valOf(node)
  if (v === undefined) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function intAttr(node: XNode | undefined, name: string): number | null {
  const v = attr(node, name)
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 子要素の一部だけを XML 文字列として退避する (raw* フィールド用) */
export function serializeChildren(nodes: XNode[]): string | null {
  if (nodes.length === 0) return null
  return buildXml(nodes)
}

// ───────────────────────── 書き出しエミッタ ─────────────────────────

/** XML テキストのエスケープ。属性値と本文の両方に使える最小集合 */
export function escapeXml(s: string): string {
  let out = ''
  for (const ch of s) {
    switch (ch) {
      case '&':
        out += '&amp;'
        break
      case '<':
        out += '&lt;'
        break
      case '>':
        out += '&gt;'
        break
      case '"':
        out += '&quot;'
        break
      default: {
        const code = ch.codePointAt(0) ?? 0
        // XML 1.0 で許されない制御文字は落とす (Word が読めなくなるため)
        if (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') break
        out += ch
      }
    }
  }
  return out
}

export type AttrMap = Record<string, string | number | boolean | null | undefined>

function renderAttrs(attrs: AttrMap | undefined): string {
  if (!attrs) return ''
  let out = ''
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    out += ` ${k}="${escapeXml(String(v))}"`
  }
  return out
}

/** 空要素 <w:b/> */
export function el(tag: string, attrs?: AttrMap): string {
  return `<${tag}${renderAttrs(attrs)}/>`
}

/** 子を持つ要素。children が空なら空要素にする */
export function wrap(tag: string, attrs: AttrMap | undefined, children: string): string {
  if (!children) return el(tag, attrs)
  return `<${tag}${renderAttrs(attrs)}>${children}</${tag}>`
}

/**
 * テキスト要素。
 *
 * 空白を含むときは必ず xml:space="preserve" を付ける。
 * 仕様上必要なのは前後の空白だけだが、Word 自身が常に付けるので同じ挙動にしておく。
 * コストはゼロで、Word の空白処理の癖を踏む危険を避けられる。
 */
export function textEl(tag: string, text: string, attrs?: AttrMap): string {
  const needsPreserve = /\s/.test(text)
  const merged: AttrMap = { ...attrs }
  if (needsPreserve) merged['xml:space'] = 'preserve'
  return `<${tag}${renderAttrs(merged)}>${escapeXml(text)}</${tag}>`
}

/** w:val だけを持つ要素 */
export function valEl(tag: string, value: string | number | boolean): string {
  return el(tag, { 'w:val': typeof value === 'boolean' ? (value ? '1' : '0') : value })
}

/** フラグ要素。true なら <w:b/>、false なら出力しない (既定が false のため) */
export function flagEl(tag: string, on: boolean): string {
  return on ? el(tag) : ''
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
