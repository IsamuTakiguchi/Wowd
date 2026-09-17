/**
 * 段落属性 (w:pPr) の TipTap 属性定義と CSS への写像。
 *
 * paragraph と heading は Word では同じ w:p なので、属性定義を共有する。
 * 値は twip などの OOXML ネイティブ単位のまま保持し、px 化はここ (描画直前) だけで行う。
 */
import type { ParagraphAttrs, ParagraphIndent, ParagraphSpacing } from '@core/model/types'
import { twipToPt } from '@shared/units'

export const DEFAULT_PARAGRAPH_ATTRS: ParagraphAttrs = {
  pStyle: null,
  numPr: null,
  jc: null,
  spacing: null,
  ind: null,
  outlineLvl: null,
  keepNext: false,
  keepLines: false,
  pageBreakBefore: false,
  snapToGrid: true,
  sectionId: null,
  paraId: null,
  markRunProps: null,
  rawPPr: null,
  pPrChange: null
}

/** JSON 由来の値をそのまま持ち回すだけの属性 (HTML には出さない) */
function passthrough<T>(def: T) {
  return {
    default: def,
    parseHTML: () => def,
    renderHTML: () => ({}),
    keepOnSplit: true
  }
}

const JC_TO_CSS: Record<string, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  both: 'justify',
  distribute: 'justify'
}

/**
 * w:ind を CSS に写す。
 * 日本語 Word は *Chars (1/100 文字単位) を好んで使い、twip より優先される。
 */
export function indentToCss(ind: ParagraphIndent | null): Record<string, string> {
  if (!ind) return {}
  const css: Record<string, string> = {}
  if (ind.leftChars != null) css['margin-inline-start'] = `${ind.leftChars / 100}em`
  else if (ind.left != null) css['margin-inline-start'] = `${twipToPt(ind.left)}pt`

  if (ind.rightChars != null) css['margin-inline-end'] = `${ind.rightChars / 100}em`
  else if (ind.right != null) css['margin-inline-end'] = `${twipToPt(ind.right)}pt`

  // ぶら下げインデントは負の text-indent。firstLine と同時には指定されない
  if (ind.hangingChars != null) css['text-indent'] = `${-ind.hangingChars / 100}em`
  else if (ind.hanging != null) css['text-indent'] = `${-twipToPt(ind.hanging)}pt`
  else if (ind.firstLineChars != null) css['text-indent'] = `${ind.firstLineChars / 100}em`
  else if (ind.firstLine != null) css['text-indent'] = `${twipToPt(ind.firstLine)}pt`

  return css
}

export function spacingToCss(spacing: ParagraphSpacing | null): Record<string, string> {
  if (!spacing) return {}
  const css: Record<string, string> = {}
  if (spacing.beforeLines != null) css['margin-block-start'] = `${spacing.beforeLines / 100}em`
  else if (spacing.before != null) css['margin-block-start'] = `${twipToPt(spacing.before)}pt`

  if (spacing.afterLines != null) css['margin-block-end'] = `${spacing.afterLines / 100}em`
  else if (spacing.after != null) css['margin-block-end'] = `${twipToPt(spacing.after)}pt`

  if (spacing.line != null) {
    // lineRule 'auto' の w:line は 240 分の 1 行 (240 = 単一行送り)
    if (spacing.lineRule === 'exact' || spacing.lineRule === 'atLeast') {
      css['line-height'] = `${twipToPt(spacing.line)}pt`
    } else {
      css['line-height'] = String(spacing.line / 240)
    }
  }
  return css
}

export function paragraphAttrsToStyle(attrs: Partial<ParagraphAttrs>): string {
  const css: Record<string, string> = {
    ...indentToCss(attrs.ind ?? null),
    ...spacingToCss(attrs.spacing ?? null)
  }
  if (attrs.jc && JC_TO_CSS[attrs.jc]) css['text-align'] = JC_TO_CSS[attrs.jc]!
  if (attrs.jc === 'distribute') css['text-align-last'] = 'justify'
  if (attrs.keepNext) css['break-after'] = 'avoid'
  if (attrs.keepLines) css['break-inside'] = 'avoid'
  if (attrs.pageBreakBefore) css['break-before'] = 'page'

  return Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

/** TipTap の addAttributes() に流し込む定義 */
export function paragraphAttributeSpec() {
  return {
    pStyle: passthrough<string | null>(null),
    numPr: passthrough<ParagraphAttrs['numPr']>(null),
    jc: passthrough<ParagraphAttrs['jc']>(null),
    spacing: passthrough<ParagraphSpacing | null>(null),
    ind: passthrough<ParagraphIndent | null>(null),
    outlineLvl: passthrough<number | null>(null),
    keepNext: passthrough(false),
    keepLines: passthrough(false),
    pageBreakBefore: passthrough(false),
    snapToGrid: passthrough(true),
    sectionId: passthrough<string | null>(null),
    // paraId は分割時に引き継ぐと Word 側で重複するので、新しい段落には引き継がない
    paraId: { default: null, parseHTML: () => null, renderHTML: () => ({}), keepOnSplit: false },
    markRunProps: passthrough<ParagraphAttrs['markRunProps']>(null),
    rawPPr: passthrough<string | null>(null),
    pPrChange: passthrough<ParagraphAttrs['pPrChange']>(null)
  }
}

/** ノード属性から ParagraphAttrs を組み立てる (欠けた項目は既定値で補う) */
export function toParagraphAttrs(attrs: Record<string, unknown>): ParagraphAttrs {
  const out = { ...DEFAULT_PARAGRAPH_ATTRS }
  for (const key of Object.keys(DEFAULT_PARAGRAPH_ATTRS) as (keyof ParagraphAttrs)[]) {
    if (attrs[key] !== undefined) {
      // 属性は WowdDoc からそのまま来る。型は schema.ts 側で保証する
      ;(out as unknown as Record<string, unknown>)[key] = attrs[key]
    }
  }
  return out
}
