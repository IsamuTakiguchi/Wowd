import { TextStyle } from '@tiptap/extension-text-style'
import type { RunProps, RunFonts } from '@core/model/types'
import { halfPtToPt, twipToPt } from '@shared/units'

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

/**
 * w:rPr に対応するマーク。TipTap の TextStyle を拡張し、
 * fontFamily 1 本では表現できない和欧混植や文字間隔をまとめて 1 属性に持つ。
 */
export const WRunProps = TextStyle.extend({
  name: 'textStyle',

  addAttributes() {
    return {
      runProps: {
        default: null as RunProps | null,
        parseHTML: (): RunProps | null => null,
        renderHTML: (attrs: Record<string, unknown>) => {
          const rp = attrs['runProps'] as RunProps | null
          if (!rp) return {}
          const style = runPropsToStyle(rp)
          return style ? { style } : {}
        }
      }
    }
  }
})

/** 部分更新用。null 指定でその項目を消せるよう undefined と区別する */
export function mergeRunProps(base: RunProps | null, patch: Partial<RunProps>): RunProps {
  return { ...(base ?? DEFAULT_RUN_PROPS), ...patch }
}

/** 全項目が既定値なら true。マークを外してよいかの判定に使う */
export function isEmptyRunProps(rp: RunProps | null): boolean {
  if (!rp) return true
  return (Object.keys(DEFAULT_RUN_PROPS) as (keyof RunProps)[]).every((k) => rp[k] == null)
}
