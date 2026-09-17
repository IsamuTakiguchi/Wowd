import type { ParagraphNode, ParagraphAttrs, SectionProps } from '../../model/types'
import { el, wrap, valEl, type AttrMap } from '../xml'
import { PPR_ORDER, emitOrdered, splitFragments, type OrderedFragment } from './order'
import { writeInlineRuns, writeRunProps, emptyMarkSet } from './run'
import { writeSectionProps } from './section'

function indAttrs(ind: NonNullable<ParagraphAttrs['ind']>): AttrMap {
  return {
    'w:left': ind.left,
    'w:right': ind.right,
    'w:firstLine': ind.firstLine,
    'w:hanging': ind.hanging,
    'w:leftChars': ind.leftChars,
    'w:rightChars': ind.rightChars,
    'w:firstLineChars': ind.firstLineChars,
    'w:hangingChars': ind.hangingChars
  }
}

function spacingAttrs(sp: NonNullable<ParagraphAttrs['spacing']>): AttrMap {
  return {
    'w:before': sp.before,
    'w:after': sp.after,
    'w:beforeLines': sp.beforeLines,
    'w:afterLines': sp.afterLines,
    'w:line': sp.line,
    'w:lineRule': sp.lineRule
  }
}

function hasAnyValue(attrs: AttrMap): boolean {
  return Object.values(attrs).some((v) => v !== undefined && v !== null)
}

/** w:pPr を規定順で組み立てる */
export function writeParagraphProps(
  attrs: ParagraphAttrs,
  sections: Map<string, SectionProps>
): string {
  const frags: OrderedFragment[] = []
  const add = (tag: string, xml: string): void => {
    if (xml) frags.push({ tag, xml })
  }

  if (attrs.pStyle) add('w:pStyle', valEl('w:pStyle', attrs.pStyle))
  if (attrs.keepNext) add('w:keepNext', el('w:keepNext'))
  if (attrs.keepLines) add('w:keepLines', el('w:keepLines'))
  if (attrs.pageBreakBefore) add('w:pageBreakBefore', el('w:pageBreakBefore'))
  if (attrs.numPr) {
    add(
      'w:numPr',
      wrap('w:numPr', undefined, valEl('w:ilvl', attrs.numPr.ilvl) + valEl('w:numId', attrs.numPr.numId))
    )
  }
  // snapToGrid は既定 true なので、false のときだけ明示する
  if (!attrs.snapToGrid) add('w:snapToGrid', el('w:snapToGrid', { 'w:val': '0' }))
  if (attrs.spacing) {
    const a = spacingAttrs(attrs.spacing)
    if (hasAnyValue(a)) add('w:spacing', el('w:spacing', a))
  }
  if (attrs.ind) {
    const a = indAttrs(attrs.ind)
    if (hasAnyValue(a)) add('w:ind', el('w:ind', a))
  }
  if (attrs.jc) add('w:jc', valEl('w:jc', attrs.jc))
  if (attrs.outlineLvl != null) add('w:outlineLvl', valEl('w:outlineLvl', attrs.outlineLvl))

  if (attrs.markRunProps) {
    const set = emptyMarkSet()
    set.props = attrs.markRunProps
    add('w:rPr', writeRunProps(set))
  }

  if (attrs.sectionId) {
    const section = sections.get(attrs.sectionId)
    if (section) add('w:sectPr', writeSectionProps(section))
  }

  if (attrs.pPrChange) {
    add(
      'w:pPrChange',
      el('w:pPrChange', {
        'w:id': attrs.pPrChange.id,
        'w:author': attrs.pPrChange.author,
        'w:date': attrs.pPrChange.date
      })
    )
  }

  for (const frag of splitFragments(attrs.rawPPr)) frags.push(frag)

  const body = emitOrdered(PPR_ORDER, frags)
  return body ? wrap('w:pPr', undefined, body) : ''
}

export function writeParagraph(node: ParagraphNode, sections: Map<string, SectionProps>): string {
  const pPr = writeParagraphProps(node.attrs, sections)
  const content = writeInlineRuns(node.content ?? [])
  const attrs: AttrMap = node.attrs.paraId ? { 'w14:paraId': node.attrs.paraId } : {}
  return wrap('w:p', attrs, pPr + content)
}
