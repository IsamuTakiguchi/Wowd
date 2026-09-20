import type { ParagraphNode, ParagraphAttrs, SectionProps } from '../../model/types'
import { el, wrap, valEl, type AttrMap } from '../xml'
import { PPR_ORDER, emitOrdered, splitFragments, type OrderedFragment } from './order'
import { writeInlineRuns, writeRunProps, emptyMarkSet } from './run'
import type { CommentScope } from './commentScope'
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

  // 段落記号の書式と、段落記号そのものの挿入・削除。
  // CT_ParaRPr では w:ins / w:del が rPr の先頭に来る (他の要素より前)
  const rev = attrs.paraMarkRevision
  if (attrs.markRunProps || rev) {
    const set = emptyMarkSet()
    set.props = attrs.markRunProps
    const inner = writeRunProps(set)
    const revEl = rev
      ? el(rev.kind === 'ins' ? 'w:ins' : 'w:del', {
          'w:id': rev.meta.id,
          'w:author': rev.meta.author,
          'w:date': rev.meta.date || undefined
        })
      : ''
    // writeRunProps は w:rPr ごと返すので、開始タグの直後に差し込む
    const merged = revEl
      ? inner
        ? inner.replace('<w:rPr>', `<w:rPr>${revEl}`)
        : wrap('w:rPr', undefined, revEl)
      : inner
    add('w:rPr', merged)
  }

  if (attrs.sectionId) {
    const section = sections.get(attrs.sectionId)
    if (section) add('w:sectPr', writeSectionProps(section))
  }

  for (const frag of splitFragments(attrs.rawPPr)) frags.push(frag)

  const body = emitOrdered(PPR_ORDER, frags, 'w:pPr')
  return body ? wrap('w:pPr', undefined, body) : ''
}

export function writeParagraph(
  node: ParagraphNode,
  sections: Map<string, SectionProps>,
  scope?: CommentScope
): string {
  const pPr = writeParagraphProps(node.attrs, sections)
  const content = writeInlineRuns(node.content ?? [], false, scope)
  // モデル化していない属性 (w14:textId・w:rsid* など) も書き戻す
  const attrs: AttrMap = {
    ...(node.attrs.paraId ? { 'w14:paraId': node.attrs.paraId } : {}),
    ...(node.attrs.textId ? { 'w14:textId': node.attrs.textId } : {}),
    ...(node.attrs.rawAttrs ?? {})
  }
  return wrap('w:p', attrs, pPr + content)
}
