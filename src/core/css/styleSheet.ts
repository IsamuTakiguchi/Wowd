import type { StyleTable, RunProps, ParagraphAttrs } from '../model/types'
import { effectiveParagraphProps, effectiveRunProps } from '../docx/read/styles'
import { paragraphAttrsToStyle } from './paragraphCss'
import { runPropsToStyle, DEFAULT_RUN_PROPS } from './runCss'

/**
 * styles.xml から表示用の CSS を組み立てる。
 *
 * これが無いと「表題」「見出し 1」などのスタイルを適用しても見た目が変わらず、
 * ブラウザ既定の h1/h2 の大きさが出るだけで Word と食い違う。
 * 段落には data-style 属性を出しているので、そこに当てる。
 */
export function buildStyleSheet(styles: StyleTable, scope = '.wowd-content'): string {
  const rules: string[] = []

  // ブラウザ既定の見出しサイズが Word のスタイル定義に勝たないよう打ち消す
  rules.push(
    `${scope} h1,${scope} h2,${scope} h3,${scope} h4,${scope} h5,${scope} h6{font-size:inherit;font-weight:inherit;margin:0}`
  )

  for (const style of styles.byId.values()) {
    if (style.type !== 'paragraph' && style.type !== 'character') continue

    const declarations = style.type === 'paragraph'
      ? paragraphCss(styles, style.styleId)
      : runCss(effectiveRunProps(styles, style.styleId))

    if (!declarations) continue
    rules.push(`${scope} [data-style="${cssEscape(style.styleId)}"]{${declarations}}`)
  }

  return rules.join('\n')
}

function paragraphCss(styles: StyleTable, styleId: string): string {
  const pPr: Partial<ParagraphAttrs> = effectiveParagraphProps(styles, styleId)
  const rPr = effectiveRunProps(styles, styleId)
  return [paragraphAttrsToStyle(pPr), runCss(rPr)].filter(Boolean).join(';')
}

function runCss(rPr: Partial<RunProps>): string {
  return runPropsToStyle({ ...DEFAULT_RUN_PROPS, ...rPr })
}

/** スタイル ID は Word が付けた任意の文字列なので、属性セレクタ用にエスケープする */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}
