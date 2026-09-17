import type { SectionProps } from '../../model/types'
import { el, wrap, valEl } from '../xml'
import { SECTPR_ORDER, emitOrdered, splitFragments, type OrderedFragment } from './order'

export function writeSectionProps(section: SectionProps): string {
  const frags: OrderedFragment[] = []
  const add = (tag: string, xml: string): void => {
    if (xml) frags.push({ tag, xml })
  }

  if (section.type !== 'nextPage') add('w:type', valEl('w:type', section.type))

  for (const [kind, refs] of [
    ['w:headerReference', section.headerRefs],
    ['w:footerReference', section.footerRefs]
  ] as const) {
    for (const [type, rId] of Object.entries(refs)) {
      if (rId) add(kind, el(kind, { 'w:type': type, 'r:id': rId }))
    }
  }

  add(
    'w:pgSz',
    el('w:pgSz', {
      'w:w': section.pgSz.w,
      'w:h': section.pgSz.h,
      'w:orient': section.pgSz.orient ?? undefined
    })
  )
  add(
    'w:pgMar',
    el('w:pgMar', {
      'w:top': section.pgMar.top,
      'w:right': section.pgMar.right,
      'w:bottom': section.pgMar.bottom,
      'w:left': section.pgMar.left,
      'w:header': section.pgMar.header,
      'w:footer': section.pgMar.footer,
      'w:gutter': section.pgMar.gutter
    })
  )
  if (section.pgNumType) {
    add(
      'w:pgNumType',
      el('w:pgNumType', { 'w:start': section.pgNumType.start, 'w:fmt': section.pgNumType.fmt })
    )
  }
  if (section.cols) {
    add(
      'w:cols',
      el('w:cols', {
        'w:num': section.cols.num,
        'w:space': section.cols.space,
        'w:equalWidth': section.cols.equalWidth ? undefined : '0'
      })
    )
  }
  if (section.titlePg) add('w:titlePg', el('w:titlePg'))
  if (section.docGrid) {
    add(
      'w:docGrid',
      el('w:docGrid', {
        'w:type': section.docGrid.type ?? undefined,
        'w:linePitch': section.docGrid.linePitch,
        'w:charSpace': section.docGrid.charSpace || undefined
      })
    )
  }

  for (const frag of splitFragments(section.rawSectPr)) frags.push(frag)

  return wrap('w:sectPr', undefined, emitOrdered(SECTPR_ORDER, frags))
}
