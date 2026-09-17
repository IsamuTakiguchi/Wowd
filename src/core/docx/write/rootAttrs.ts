/**
 * 書き出すパートのルート要素に付ける名前空間宣言。
 *
 * 未対応の要素は原文のまま書き戻す方針なので、**原文が使っている接頭辞が
 * 宣言されていないと、名前空間として不正な XML になる**。整形式ですらないので
 * Word は開くことすらできない。
 *
 * 実際に 2 度これをやっている:
 *   - w:drawing が wp: を宣言していなかった
 *   - numbering.xml を書き直すと w15: の宣言だけが消えていた
 *     (テンプレートの numbering.xml は w15:tentative を持っている)
 *
 * したがって、原本があるパートは**原本のルート属性をそのまま引き継ぐ**。
 * 新しく作るパートには、拡張を含む広めの既定を付ける。
 */

/** 原本が無いときの既定。Word が書くものに合わせて拡張まで宣言しておく */
export const COMMON_ROOT_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ' +
  'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'mc:Ignorable="w14 w15 wp14"'

/**
 * 原本のルート開始タグから名前空間宣言を取り出す。
 *
 * @param originalXml 元のパート。新規作成なら null
 * @param tag ルート要素名 (w:numbering など)
 */
export function rootAttrsOf(
  originalXml: string | null,
  tag: string,
  fallback: string = COMMON_ROOT_NS
): string {
  if (!originalXml) return fallback
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const raw = new RegExp(`<${escaped}\\b([^>]*)>`).exec(originalXml)?.[1]
  // 空のパートはルートが自己終了タグになっている (<w:comments .../>)。
  // 末尾の / まで属性として拾うと <w:comments ...//> になり、XML が壊れる
  const attrs = raw?.replace(/\/\s*$/, '').trim()
  return attrs && attrs.length > 0 ? attrs : fallback
}

/** こちらが実際に書き出す拡張の接頭辞と、その名前空間 */
const EXTENSION_NS: Record<string, string> = {
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml'
}

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

/**
 * 実際に書き出す拡張が、宣言され、かつ mc:Ignorable に載っている状態にする。
 *
 * 段落には w14:paraId を書く (コメントのスレッドを結ぶのに要る)。
 * MCE では「拡張を書くなら mc:Ignorable に挙げる」のが約束で、
 * 挙げないと、その拡張を知らない消費者は**文書を拒否してよい**ことになる。
 *
 * 原本のルート属性をそのまま引き継ぐだけでは足りない。
 * テンプレートの comments.xml は xmlns:w14 を宣言しているが
 * mc:Ignorable を持っておらず、そこに w14:paraId を書くと約束を破ることになる。
 */
export function ensureIgnorable(attrs: string, prefixes: string[]): string {
  let out = attrs
  const missing: string[] = []

  for (const prefix of prefixes) {
    const uri = EXTENSION_NS[prefix]
    if (!uri) continue
    if (!new RegExp(`\\bxmlns:${prefix}\\s*=`).test(out)) {
      out += ` xmlns:${prefix}="${uri}"`
    }
    missing.push(prefix)
  }
  if (missing.length === 0) return out

  if (!/\bxmlns:mc\s*=/.test(out)) out += ` xmlns:mc="${MC_NS}"`

  const found = /\bmc:Ignorable\s*=\s*"([^"]*)"/.exec(out)
  const listed = new Set((found?.[1] ?? '').split(/\s+/).filter((p) => p.length > 0))
  for (const prefix of missing) listed.add(prefix)
  const value = [...listed].join(' ')

  return found
    ? out.replace(/\bmc:Ignorable\s*=\s*"[^"]*"/, `mc:Ignorable="${value}"`)
    : `${out} mc:Ignorable="${value}"`
}

/** ルート属性を生文字列として差し込むための目印 */
export const ROOT_ATTR_MARK = '__rootAttrs=""'

/** wrap() に渡す属性。差し込み後に ROOT_ATTR_MARK を置換する */
export const ROOT_ATTR_PLACEHOLDER = { __rootAttrs: '' }

/** 目印を実際の宣言に置き換える */
export function applyRootAttrs(xml: string, attrs: string): string {
  return xml.replace(ROOT_ATTR_MARK, attrs)
}
