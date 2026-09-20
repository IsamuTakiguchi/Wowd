import type { SectionProps } from '../../model/types'
import {
  type XNode,
  tagOf,
  childrenOf,
  attr,
  intAttr,
  boolVal,
  valOf,
  serializeChildren,
  otherAttrs
} from '../xml'

const KNOWN_SECTPR = new Set([
  'w:pgSz',
  'w:pgMar',
  'w:cols',
  'w:docGrid',
  'w:headerReference',
  'w:footerReference',
  'w:titlePg',
  'w:pgNumType',
  'w:type'
])

/** A4 縦、余白 1 インチ。Word の既定に合わせた値 */
export function defaultSection(id: string): SectionProps {
  return {
    id,
    pgSz: { w: 11906, h: 16838, orient: null },
    pgMar: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 851, footer: 992, gutter: 0 },
    cols: null,
    docGrid: null,
    headerRefs: {},
    footerRefs: {},
    titlePg: false,
    pgNumType: null,
    type: 'nextPage',
    rawSectPr: null,
    rawAttrs: null
  }
}

/** w:docGrid/@w:type を既知の値に正規化する */
export function normalizeDocGridType(
  v: string | undefined
): NonNullable<SectionProps['docGrid']>['type'] {
  if (v === undefined) return null
  return v === 'lines' || v === 'linesAndChars' || v === 'snapToChars' || v === 'default'
    ? v
    : 'default'
}

export function readSection(sectPr: XNode, id: string): SectionProps {
  const out = defaultSection(id)
  const leftovers: XNode[] = []

  for (const child of childrenOf(sectPr)) {
    const tag = tagOf(child)
    if (!KNOWN_SECTPR.has(tag)) {
      leftovers.push(child)
      continue
    }
    switch (tag) {
      case 'w:pgSz': {
        const w = intAttr(child, 'w:w')
        const h = intAttr(child, 'w:h')
        if (w != null) out.pgSz.w = w
        if (h != null) out.pgSz.h = h
        // 属性が無ければ null のまま。書き戻しで勝手に付けないため
        const orient = attr(child, 'w:orient')
        if (orient === 'landscape' || orient === 'portrait') out.pgSz.orient = orient
        break
      }
      case 'w:pgMar': {
        const keys = ['top', 'right', 'bottom', 'left', 'header', 'footer', 'gutter'] as const
        for (const k of keys) {
          const v = intAttr(child, `w:${k}`)
          if (v != null) out.pgMar[k] = v
        }
        break
      }
      case 'w:cols':
        out.cols = {
          // 属性が無ければ null。既定値で埋めると書き出しで増えてしまう
          num: intAttr(child, 'w:num'),
          space: intAttr(child, 'w:space'),
          equalWidth: attr(child, 'w:equalWidth') !== '0'
        }
        break
      case 'w:docGrid':
        out.docGrid = {
          type: normalizeDocGridType(attr(child, 'w:type')),  // 属性不在なら null
          linePitch: intAttr(child, 'w:linePitch') ?? 360,
          charSpace: intAttr(child, 'w:charSpace') ?? 0
        }
        break
      case 'w:headerReference':
      case 'w:footerReference': {
        const type = attr(child, 'w:type') ?? 'default'
        const rId = attr(child, 'r:id')
        if (!rId) break
        const target = tag === 'w:headerReference' ? out.headerRefs : out.footerRefs
        if (type === 'first') target.first = rId
        else if (type === 'even') target.even = rId
        else target.default = rId
        break
      }
      case 'w:titlePg':
        out.titlePg = boolVal(child)
        break
      case 'w:pgNumType': {
        // 属性が無くても「要素が存在した」ことは残す。空要素を落とさないため
        const start = intAttr(child, 'w:start')
        const fmt = attr(child, 'w:fmt')
        out.pgNumType = { ...(start != null ? { start } : {}), ...(fmt ? { fmt } : {}) }
        break
      }
      case 'w:type': {
        const v = valOf(child)
        if (v === 'continuous' || v === 'evenPage' || v === 'oddPage' || v === 'nextPage') {
          out.type = v
        }
        break
      }
    }
  }

  out.rawSectPr = serializeChildren(leftovers)
  // 属性 (w:rsid* など) もそのまま書き戻す
  const rest = otherAttrs(sectPr, [])
  if (Object.keys(rest).length > 0) out.rawAttrs = rest
  return out
}

