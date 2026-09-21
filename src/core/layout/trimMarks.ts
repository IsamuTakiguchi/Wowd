/**
 * 裁ちトンボ (トリムマーク) の作図。DOM にも Electron にも依存しない純粋関数だけを置く。
 *
 * 印刷所に入稿するとき、紙は仕上がりサイズより大きく刷って断裁する。
 * どこで断つかを示すのがトンボで、日本の印刷では次の形が標準:
 *
 *   角トンボ … 四隅の二重のカギ線。内側が仕上がり線、外側が塗り足し線 (3mm 外)
 *   センタートンボ … 各辺の中央の十字。断裁機の位置合わせに使う
 *
 * 内側の線は仕上がりの角に届かない。角から塗り足しぶん離れたところで止める。
 * 断裁の線そのものを紙に印刷してしまうと、断ち切れずに残ったとき製品に出るため。
 *
 * 単位は他と同じく twip のまま扱う。px も mm も描画側の都合なので、ここには持ち込まない。
 */
import type { Twip } from '../model/types'
import { mmToTwip, twipToMm } from '../../shared/units'

/** 塗り足し。日本の印刷所はほぼ 3mm で統一されている */
export const DEFAULT_BLEED_MM = 3
/** トンボの線の長さ。10mm が標準 */
export const DEFAULT_MARK_LENGTH_MM = 10
/**
 * 線の太さ。
 *
 * 印刷の慣例は 0.1mm 前後だが、それだと画面で見えない。
 * 0.2mm は画面で見えて、断裁の精度 (±1mm 程度) にも十分細い。
 */
export const DEFAULT_LINE_WIDTH_MM = 0.2

export interface TrimMarkOptions {
  /** 仕上がりサイズ (= 文書のページサイズ) */
  finishInline: Twip
  finishBlock: Twip
  bleed?: Twip
  markLength?: Twip
  lineWidth?: Twip
  /** センタートンボを描くか。既定は描く */
  center?: boolean
}

export interface TrimMarkLine {
  x1: Twip
  y1: Twip
  x2: Twip
  y2: Twip
}

export interface TrimMarkLayout {
  /** トンボまで含めた用紙全体。印刷するときはこの寸法の紙を使う */
  sheetInline: Twip
  sheetBlock: Twip
  /** 用紙の左上から見た、仕上がり領域の左上。四辺とも同じ値になる */
  offset: Twip
  bleed: Twip
  lineWidth: Twip
  /** 用紙の左上を原点とする線分。すべて水平か垂直 */
  lines: TrimMarkLine[]
}

/**
 * トンボの線と、それを載せる用紙の寸法を求める。
 *
 * 用紙は仕上がりサイズの四辺に (塗り足し + 線の長さ) を足した大きさになる。
 * 既定なら各辺 13mm ぶん大きい。
 */
export function trimMarkLayout(options: TrimMarkOptions): TrimMarkLayout {
  const bleed = options.bleed ?? mmToTwip(DEFAULT_BLEED_MM)
  const markLength = options.markLength ?? mmToTwip(DEFAULT_MARK_LENGTH_MM)
  const lineWidth = options.lineWidth ?? mmToTwip(DEFAULT_LINE_WIDTH_MM)
  const withCenter = options.center ?? true

  const offset = bleed + markLength
  const w = options.finishInline
  const h = options.finishBlock
  const sheetInline = w + offset * 2
  const sheetBlock = h + offset * 2

  // 仕上がり線の位置 (用紙の左上が原点)
  const trimLeft = offset
  const trimTop = offset
  const trimRight = offset + w
  const trimBottom = offset + h
  // 塗り足し線の位置
  const bleedLeft = trimLeft - bleed
  const bleedTop = trimTop - bleed
  const bleedRight = trimRight + bleed
  const bleedBottom = trimBottom + bleed

  const lines: TrimMarkLine[] = []
  const h_ = (y: Twip, x1: Twip, x2: Twip): void => void lines.push({ x1, y1: y, x2, y2: y })
  const v_ = (x: Twip, y1: Twip, y2: Twip): void => void lines.push({ x1: x, y1, x2: x, y2 })

  // 角トンボ。各隅で水平 2 本 + 垂直 2 本。
  // 内側 (仕上がり線) と外側 (塗り足し線) が重なってカギ形に見える。
  // 線は紙の端から始まり、塗り足し線で止まる。角には届かない
  // 左上
  h_(trimTop, 0, bleedLeft)
  h_(bleedTop, 0, bleedLeft)
  v_(trimLeft, 0, bleedTop)
  v_(bleedLeft, 0, bleedTop)
  // 右上
  h_(trimTop, bleedRight, sheetInline)
  h_(bleedTop, bleedRight, sheetInline)
  v_(trimRight, 0, bleedTop)
  v_(bleedRight, 0, bleedTop)
  // 左下
  h_(trimBottom, 0, bleedLeft)
  h_(bleedBottom, 0, bleedLeft)
  v_(trimLeft, bleedBottom, sheetBlock)
  v_(bleedLeft, bleedBottom, sheetBlock)
  // 右下
  h_(trimBottom, bleedRight, sheetInline)
  h_(bleedBottom, bleedRight, sheetInline)
  v_(trimRight, bleedBottom, sheetBlock)
  v_(bleedRight, bleedBottom, sheetBlock)

  if (withCenter) {
    const midX = trimLeft + w / 2
    const midY = trimTop + h / 2
    // 辺に垂直な線は紙の端から塗り足し線まで。その中点で直交する短い線と十字を作る
    const cross = markLength / 2
    // 上下
    v_(midX, 0, bleedTop)
    h_(bleedTop - markLength / 2, midX - cross / 2, midX + cross / 2)
    v_(midX, bleedBottom, sheetBlock)
    h_(bleedBottom + markLength / 2, midX - cross / 2, midX + cross / 2)
    // 左右
    h_(midY, 0, bleedLeft)
    v_(bleedLeft - markLength / 2, midY - cross / 2, midY + cross / 2)
    h_(midY, bleedRight, sheetInline)
    v_(bleedRight + markLength / 2, midY - cross / 2, midY + cross / 2)
  }

  return { sheetInline, sheetBlock, offset, bleed, lineWidth, lines }
}

/**
 * トンボを SVG にする。
 *
 * viewBox は twip のまま。表示側が幅と高さを mm でも px でも与えられるようにしておく
 * (画面は px、印刷は mm で、同じ図をそのまま使う)。
 *
 * 色は黒。印刷所に出すならレジストレーションカラー (CMYK 4 色 100%) が本式だが、
 * それは PDF を CMYK で作れる場合の話で、ここは RGB の PDF なので黒にする。
 */
export function trimMarkSvg(layout: TrimMarkLayout, attrs: { width: string; height: string }): string {
  const d = layout.lines
    .map((l) => `M${round(l.x1)} ${round(l.y1)}L${round(l.x2)} ${round(l.y2)}`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${attrs.width}" height="${attrs.height}" ` +
    `viewBox="0 0 ${round(layout.sheetInline)} ${round(layout.sheetBlock)}" ` +
    `aria-hidden="true" focusable="false">` +
    `<path d="${d}" stroke="#000" stroke-width="${round(layout.lineWidth)}" fill="none" />` +
    `</svg>`
  )
}

/** 印刷の指定に使う、トンボ込みの用紙サイズ (mm) */
export function trimMarkPaperMm(layout: TrimMarkLayout): { widthMm: number; heightMm: number } {
  return { widthMm: twipToMm(layout.sheetInline), heightMm: twipToMm(layout.sheetBlock) }
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
