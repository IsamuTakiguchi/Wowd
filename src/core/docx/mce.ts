import { parseXml, buildXml, tagOf, childrenOf, type XNode } from './xml'

/**
 * MCE (Markup Compatibility and Extensibility, ECMA-376 Part 3) の前処理。
 *
 * Word が書く .docx のルート要素には `mc:Ignorable="w14 w15 wp14"` が付いている。
 * これは「この接頭辞の要素と属性は、知らない消費者は無視してよい」という宣言で、
 * `w14:paraId` のような Microsoft 拡張を、規格に沿った消費者と共存させるための仕組み。
 *
 * ECMA-376 の XSD は当然これらの拡張を知らない (`CT_P` は任意属性を許さない) ので、
 * そのまま XSD に当てると **正しいファイルが不合格になる**。
 *
 * ここでは MCE を実装した消費者と同じことをする:
 *   1. ルートの mc:Ignorable に挙がった接頭辞を集める
 *   2. その名前空間の要素と属性を落とす
 *   3. mc: 自身の宣言も落とす
 *
 * 落とすのは検証のためだけで、保存する中身には一切触れない。
 */

/** 常に無視してよい接頭辞。mc 自体は MCE の制御用で本文ではない */
const ALWAYS_IGNORED = ['mc']

/** 開始タグの属性から mc:Ignorable の値を読む */
function ignorablePrefixes(root: XNode): string[] {
  const attrs = root[':@'] ?? {}
  const raw = attrs['@_mc:Ignorable'] ?? ''
  const listed = raw.split(/\s+/).filter((p) => p.length > 0)
  return [...new Set([...listed, ...ALWAYS_IGNORED])]
}

function prefixOf(name: string): string | null {
  const idx = name.indexOf(':')
  return idx === -1 ? null : name.slice(0, idx)
}

/** その接頭辞が無視対象か。属性名は '@_' が付いている */
function isIgnored(name: string, ignored: Set<string>): boolean {
  const bare = name.startsWith('@_') ? name.slice(2) : name
  // 名前空間宣言そのもの (xmlns:w14) も落とす。落とさないと未使用宣言が残る
  if (bare.startsWith('xmlns:')) return ignored.has(bare.slice('xmlns:'.length))
  const prefix = prefixOf(bare)
  return prefix != null && ignored.has(prefix)
}

function stripNode(node: XNode, ignored: Set<string>): XNode | null {
  const tag = tagOf(node)
  if (tag && isIgnored(tag, ignored)) return null

  const out: XNode = {}

  const attrs = node[':@']
  if (attrs) {
    const kept: Record<string, string> = {}
    for (const [key, value] of Object.entries(attrs)) {
      if (isIgnored(key, ignored)) continue
      kept[key] = value
    }
    if (Object.keys(kept).length > 0) out[':@'] = kept
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === ':@') continue
    if (!Array.isArray(value)) {
      out[key] = value
      continue
    }
    const children: XNode[] = []
    for (const child of value as XNode[]) {
      const stripped = stripNode(child, ignored)
      if (stripped) children.push(stripped)
    }
    out[key] = children
  }

  return out
}

/**
 * mc:Ignorable に従って拡張を落とした XML を返す。
 *
 * @param xml 元の XML (変更しない)
 */
export function stripIgnorableMarkup(xml: string): string {
  const tree = parseXml(xml)
  const root = tree.find((n) => {
    const tag = tagOf(n)
    return tag !== '' && tag !== '?xml' && !tag.startsWith('#')
  })
  if (!root) return xml

  const ignored = new Set(ignorablePrefixes(root))
  const out: XNode[] = []
  for (const node of tree) {
    const stripped = stripNode(node, ignored)
    if (stripped) out.push(stripped)
  }
  return buildXml(out)
}

/** 無視対象の接頭辞を調べる。テストと診断用 */
export function ignoredPrefixesOf(xml: string): string[] {
  const root = parseXml(xml).find((n) => {
    const tag = tagOf(n)
    return tag !== '' && tag !== '?xml' && !tag.startsWith('#')
  })
  return root ? ignorablePrefixes(root).sort() : []
}

/** 子要素を数える。テスト用の小さな補助 */
export function countElements(xml: string, tag: string): number {
  let n = 0
  const walk = (nodes: XNode[]): void => {
    for (const node of nodes) {
      if (tagOf(node) === tag) n++
      walk(childrenOf(node))
    }
  }
  walk(parseXml(xml))
  return n
}
