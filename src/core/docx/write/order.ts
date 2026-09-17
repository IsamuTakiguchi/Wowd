/**
 * WML の子要素順序テーブル。
 *
 * ECMA-376 の CT_PPr / CT_RPr / CT_SectPr は xsd:sequence なので、子要素の順序は
 * 「推奨」ではなく必須。順序を間違えたファイルは Word が黙って「問題を修復しますか」を出すか、
 * そのまま開けなくなる。ここを正とし、シリアライザは必ずこの順で出力する。
 *
 * 出典: ECMA-376 Part 1, 17.3.1.26 (pPr) / 17.3.2.27 (rPr) / 17.6.17 (sectPr)
 */

export const PPR_ORDER: string[] = [
  'w:pStyle',
  'w:keepNext',
  'w:keepLines',
  'w:pageBreakBefore',
  'w:framePr',
  'w:widowControl',
  'w:numPr',
  'w:suppressLineNumbers',
  'w:pBdr',
  'w:shd',
  'w:tabs',
  'w:suppressAutoHyphens',
  'w:kinsoku',
  'w:wordWrap',
  'w:overflowPunct',
  'w:topLinePunct',
  'w:autoSpaceDE',
  'w:autoSpaceDN',
  'w:bidi',
  'w:adjustRightInd',
  'w:snapToGrid',
  'w:spacing',
  'w:ind',
  'w:contextualSpacing',
  'w:mirrorIndents',
  'w:suppressOverlap',
  'w:jc',
  'w:textDirection',
  'w:textAlignment',
  'w:textboxTightWrap',
  'w:outlineLvl',
  'w:divId',
  'w:cnfStyle',
  'w:rPr',
  'w:sectPr',
  'w:pPrChange'
]

export const RPR_ORDER: string[] = [
  'w:rStyle',
  'w:rFonts',
  'w:b',
  'w:bCs',
  'w:i',
  'w:iCs',
  'w:caps',
  'w:smallCaps',
  'w:strike',
  'w:dstrike',
  'w:outline',
  'w:shadow',
  'w:emboss',
  'w:imprint',
  'w:noProof',
  'w:snapToGrid',
  'w:vanish',
  'w:webHidden',
  'w:color',
  'w:spacing',
  'w:w',
  'w:kern',
  'w:position',
  'w:sz',
  'w:szCs',
  'w:highlight',
  'w:u',
  'w:effect',
  'w:bdr',
  'w:shd',
  'w:fitText',
  'w:vertAlign',
  'w:rtl',
  'w:cs',
  'w:em',
  'w:lang',
  'w:eastAsianLayout',
  'w:specVanish',
  'w:oMath',
  'w:rPrChange'
]

export const SECTPR_ORDER: string[] = [
  'w:footnotePr',
  'w:endnotePr',
  'w:type',
  'w:pgSz',
  'w:pgMar',
  'w:paperSrc',
  'w:pgBorders',
  'w:lnNumType',
  'w:pgNumType',
  'w:cols',
  'w:formProt',
  'w:vAlign',
  'w:noEndnote',
  'w:titlePg',
  'w:textDirection',
  'w:bidi',
  'w:rtlGutter',
  'w:docGrid',
  'w:printerSettings',
  'w:sectPrChange'
]

export const TBLPR_ORDER: string[] = [
  'w:tblStyle',
  'w:tblpPr',
  'w:tblOverlap',
  'w:bidiVisual',
  'w:tblStyleRowBandSize',
  'w:tblStyleColBandSize',
  'w:tblW',
  'w:jc',
  'w:tblCellSpacing',
  'w:tblInd',
  'w:tblBorders',
  'w:shd',
  'w:tblLayout',
  'w:tblCellMar',
  'w:tblLook',
  'w:tblCaption',
  'w:tblDescription'
]

export const TCPR_ORDER: string[] = [
  'w:cnfStyle',
  'w:tcW',
  'w:gridSpan',
  'w:hMerge',
  'w:vMerge',
  'w:tcBorders',
  'w:shd',
  'w:noWrap',
  'w:tcMar',
  'w:textDirection',
  'w:tcFitText',
  'w:vAlign',
  'w:hideMark'
]

export const LVL_ORDER: string[] = [
  'w:start',
  'w:numFmt',
  'w:lvlRestart',
  'w:pStyle',
  'w:isLgl',
  'w:suff',
  'w:lvlText',
  'w:lvlPicBulletId',
  'w:legacy',
  'w:lvlJc',
  'w:pPr',
  'w:rPr'
]

export interface OrderedFragment {
  tag: string
  xml: string
}

/**
 * 断片を規定順に並べて連結する。
 * order に現れないタグは末尾にまとめる (未知要素を落とさないため)。
 */
export function emitOrdered(order: string[], fragments: OrderedFragment[]): string {
  const rank = new Map(order.map((tag, i) => [tag, i]))
  const known: OrderedFragment[] = []
  const unknown: OrderedFragment[] = []
  for (const f of fragments) {
    if (!f.xml) continue
    if (rank.has(f.tag)) known.push(f)
    else unknown.push(f)
  }
  known.sort((a, b) => (rank.get(a.tag) ?? 0) - (rank.get(b.tag) ?? 0))
  return [...known, ...unknown].map((f) => f.xml).join('')
}

/**
 * raw 退避した XML 断片から、先頭のタグ名を取り出す。
 * 順序テーブルに載せ直すために必要。
 */
export function firstTagOf(xml: string): string {
  const m = /^\s*<([A-Za-z_][\w.:-]*)/.exec(xml)
  return m?.[1] ?? ''
}

/** 複数要素を含む raw 断片を、要素ごとの OrderedFragment に割る */
export function splitFragments(xml: string | null): OrderedFragment[] {
  if (!xml) return []
  const out: OrderedFragment[] = []
  const re = /<([A-Za-z_][\w.:-]*)(?:\s[^>]*?)?(\/>|>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1]!
    const start = m.index
    if (m[2] === '/>') {
      out.push({ tag, xml: xml.slice(start, re.lastIndex) })
      continue
    }
    // 同名タグの入れ子に耐えるため、深さを数えて閉じタグを探す
    const closeRe = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>|<${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s[^>]*?)?>`, 'g')
    closeRe.lastIndex = re.lastIndex
    let depth = 1
    let end = -1
    let c: RegExpExecArray | null
    while ((c = closeRe.exec(xml)) !== null) {
      if (c[0].startsWith('</')) {
        depth--
        if (depth === 0) {
          end = closeRe.lastIndex
          break
        }
      } else depth++
    }
    if (end === -1) break
    out.push({ tag, xml: xml.slice(start, end) })
    re.lastIndex = end
  }
  return out
}
