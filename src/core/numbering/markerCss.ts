/**
 * 行頭記号の置き方。画面 (Decoration) と印刷用 HTML で共有する。
 */
import type { NumberingLevel, ParagraphIndent } from '../model/types'
import { twipToPt } from '../../shared/units'

export interface MarkerCss {
  /** 記号の箱に当てる CSS。空なら何も当てない */
  box: string
  /** 記号の文字に当てる CSS (文字の幅の縮小など)。null なら包まない */
  glyph: string | null
  /** 区切り (タブ・空白) を箱の外に出すか */
  suffixOutside: boolean
}

/**
 * w:lvlJc に従って記号を置く。
 *
 * - 左揃え (既定): 記号はぶら下げの幅の箱に入れ、本文の手前に出す
 * - 右揃え: 記号の**右端**を 1 行目の開始位置に揃える。
 *   「第１」「⑴」のように桁数で幅が変わる番号を右で揃えるのに使う
 *   (岡口マクロの連番ランクはこの形)。幅 0 の箱から左へはみ出させる
 * - 中央揃え: 1 行目の開始位置を中心にする
 *
 * w:rPr の w:w (文字の幅) は transform で縮める。
 * 幅 0 の箱や固定幅の箱に入っているので、縮めても本文の位置は動かない。
 */
export function markerCss(level: NumberingLevel): MarkerCss {
  const scale = level.rPr?.w != null && level.rPr.w !== 100 ? level.rPr.w / 100 : null
  const jc = level.lvlJc

  if (jc === 'right' || jc === 'center') {
    const right = jc === 'right'
    return {
      box: [
        'display:inline-flex',
        'width:0',
        `justify-content:${right ? 'flex-end' : 'center'}`,
        'white-space:pre'
      ].join(';'),
      glyph: scale
        ? `display:inline-block;transform:scaleX(${scale});transform-origin:${right ? 'right' : 'center'}`
        : null,
      suffixOutside: true
    }
  }

  const ind = (level.pPr?.ind ?? null) as ParagraphIndent | null
  const hanging = !ind
    ? null
    : ind.hangingChars != null
      ? `${ind.hangingChars / 100}em`
      : ind.hanging != null
        ? `${Math.round(twipToPt(ind.hanging) * 100) / 100}pt`
        : null
  return {
    box: hanging ? `display:inline-block;width:${hanging};margin-inline-start:-${hanging}` : '',
    glyph: scale ? `display:inline-block;transform:scaleX(${scale});transform-origin:left` : null,
    suffixOutside: false
  }
}
