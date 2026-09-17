import type { ParagraphAttrs, ParagraphIndent, ParagraphSpacing } from '../model/types'
import { twipToPt } from '../../shared/units'

/**
 * w:pPr を CSS に写す純粋関数。
 * DOM にも TipTap にも依存しないので、画面表示とスタイルシート生成の両方から使える。
 */
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

export interface ParagraphCssOptions {
  /**
   * break-before / break-after / break-inside を出すか。
   *
   * 画面では無害だが、印刷用に組んだ「1 ページ 1 div」の文書に混ざると、
   * こちらが決めた改ページの上から Chromium が勝手に改ページしてしまう。
   * 印刷側は false を渡す。
   */
  fragmentation?: boolean
}

export function paragraphAttrsToStyle(
  attrs: Partial<ParagraphAttrs>,
  options: ParagraphCssOptions = {}
): string {
  const { fragmentation = true } = options
  const css: Record<string, string> = {
    ...indentToCss(attrs.ind ?? null),
    ...spacingToCss(attrs.spacing ?? null)
  }
  if (attrs.jc && JC_TO_CSS[attrs.jc]) css['text-align'] = JC_TO_CSS[attrs.jc]!
  if (attrs.jc === 'distribute') css['text-align-last'] = 'justify'
  if (fragmentation) {
    if (attrs.keepNext) css['break-after'] = 'avoid'
    if (attrs.keepLines) css['break-inside'] = 'avoid'
    if (attrs.pageBreakBefore) css['break-before'] = 'page'
  }

  return Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

