import { TextStyle } from '@tiptap/extension-text-style'
import type { RunProps } from '@core/model/types'
import { DEFAULT_RUN_PROPS, runPropsToStyle } from '@core/css/runCss'
import { hasRunFormatChange } from '@core/revisions/formatChange'

export { DEFAULT_RUN_PROPS, runPropsToStyle, fontsToCss } from '@core/css/runCss'

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
          // 文字書式の変更履歴 (w:rPrChange)。変わったことが分かる印を付ける
          const changed = hasRunFormatChange(rp.rawRPr)
            ? { 'data-format-revision': 'run', title: '文字の書式が変更されています' }
            : {}
          return style ? { style, ...changed } : changed
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
