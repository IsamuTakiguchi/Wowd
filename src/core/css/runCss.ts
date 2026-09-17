import type { RunProps, RunFonts } from '../model/types'
import { halfPtToPt, twipToPt } from '../../shared/units'

/**
 * w:rPr を CSS に写す純粋関数。
 * TipTap に依存させないことで、スタイルシート生成と単体テストから使えるようにしている。
 */
export const DEFAULT_RUN_PROPS: RunProps = {
  rFonts: null,
  sz: null,
  szCs: null,
  color: null,
  highlight: null,
  shd: null,
  spacing: null,
  w: null,
  kern: null,
  vertAlign: null,
  rStyle: null,
  lang: null,
  rawRPr: null
}

/**
 * 和欧混植を CSS に写す。
 *
 * ascii / eastAsia / hAnsi を単一の font-family に潰してはいけない。
 * ブラウザは font-family の並び順で「そのフォントが持つ字」を優先するので、
 * 欧文フォントを先に、和文フォントを後に置くと Word と同じ使い分けになる。
 */
export function fontsToCss(rFonts: RunFonts | null): string | null {
  if (!rFonts) return null
  const latin = rFonts.ascii ?? rFonts.hAnsi
  const ea = rFonts.eastAsia
  const stack: string[] = []
  // hint="eastAsia" は「曖昧な字は和文フォントで」の意味なので和文を先に置く
  if (rFonts.hint === 'eastAsia' && ea) stack.push(ea)
  if (latin) stack.push(latin)
  if (ea && !stack.includes(ea)) stack.push(ea)
  if (stack.length === 0) return null
  return stack.map((f) => (/[\s"']/.test(f) ? `"${f.replace(/"/g, '')}"` : f)).join(', ')
}

export function runPropsToStyle(rp: RunProps): string {
  const css: Record<string, string> = {}
  const family = fontsToCss(rp.rFonts)
  if (family) css['font-family'] = family
  if (rp.sz != null) css['font-size'] = `${halfPtToPt(rp.sz)}pt`
  if (rp.color && rp.color !== 'auto') css['color'] = `#${rp.color}`
  if (rp.highlight && rp.highlight !== 'none') css['background-color'] = rp.highlight
  if (rp.shd && rp.shd !== 'auto') css['background-color'] = `#${rp.shd}`
  if (rp.spacing != null) css['letter-spacing'] = `${twipToPt(rp.spacing)}pt`
  if (rp.w != null) css['transform'] = `scaleX(${rp.w / 100})`
  if (rp.vertAlign === 'superscript') {
    css['vertical-align'] = 'super'
    css['font-size'] = 'smaller'
  }
  if (rp.vertAlign === 'subscript') {
    css['vertical-align'] = 'sub'
    css['font-size'] = 'smaller'
  }
  return Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

