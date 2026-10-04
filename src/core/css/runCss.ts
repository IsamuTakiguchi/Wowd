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
  if (rp.w != null && rp.w !== 100) {
    // transform は inline の箱には効かないので inline-block にする。
    // 縮めたぶん詰める余白 (margin-right) は文字列で決まるので、scaleMarginEm で別に足す
    css['display'] = 'inline-block'
    css['transform'] = `scaleX(${rp.w / 100})`
    css['transform-origin'] = 'left'
    css['white-space'] = 'pre'
  }
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


/**
 * 文字列の幅の見積もり (em)。全角は 1、半角は 0.5 とする。
 *
 * 明朝などの和文フォントの半角は全角のちょうど半分なので、この見積もりで合う。
 * 欧文のプロポーショナルフォントではずれるが、横幅を縮める用途 (括弧を半分に、など)
 * では十分に近い。
 */
export function estimateTextEm(text: string): number {
  let em = 0
  for (const ch of text) em += isWide(ch) ? 1 : 0.5
  return em
}

function isWide(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  // 半角カナ (U+FF61–FF9F) と ASCII・ラテン文字は半角
  if (c < 0x1100) return false
  if (c >= 0xff61 && c <= 0xff9f) return false
  return true
}

/**
 * 文字の横幅 (w:w) を縮めたときに詰める量。
 *
 * scaleX は見た目だけを縮め、行の中で占める幅は元のまま残る。
 * Word では横幅を縮めると後ろの文字も詰まるので、その差を負の余白で詰める。
 * 縮めないとき (w が無い・100) は null。
 */
export function scaleMarginEm(text: string, w: number | null | undefined): number | null {
  if (w == null || w === 100) return null
  return -Math.round((1 - w / 100) * estimateTextEm(text) * 1000) / 1000
}
