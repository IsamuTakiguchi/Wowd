/**
 * 「文字数と行数」(w:docGrid) の算術。
 *
 * OOXML の定義:
 *   w:linePitch  行送り (twip)。linesPerPage = floor(textBlock / linePitch)
 *   w:charSpace  (希望する文字送り pt − 標準フォントサイズ pt) × 4096
 *                つまり charPitch_pt = fontSize_pt + charSpace / 4096
 *   w:type       default      グリッドなし
 *                lines        行グリッドのみ
 *                linesAndChars 行と文字の両方
 *                snapToChars   文字をマス目に吸着させる
 *
 * ここは純粋な算術だけ。描画は renderer 側。
 */
import type { SectionProps, HalfPt } from '../model/types'
import type { Pt } from '../../shared/units'
import { twipToPt, halfPtToPt } from '../../shared/units'
import { pageGeometry } from './pageGeometry'

/** w:charSpace の分母。仕様で 4096 固定 */
export const CHAR_SPACE_UNIT = 4096

export interface GridMetrics {
  /** 1 行あたりの文字数 */
  charsPerLine: number
  /** 1 ページあたりの行数 */
  linesPerPage: number
  /** 1 文字ぶんの送り (pt) */
  charPitchPt: Pt
  /** 1 行ぶんの送り (pt) */
  linePitchPt: Pt
  /** 本文領域 (pt) */
  textInlinePt: Pt
  textBlockPt: Pt
  /** 文字グリッドが有効か (行グリッドだけの場合は false) */
  charGridEnabled: boolean
}

/**
 * セクション設定と標準フォントサイズからグリッドの実寸を求める。
 * docGrid が無い、または type が default の場合は null。
 */
export function gridFromSection(
  section: SectionProps,
  normalSizeHalfPt: HalfPt
): GridMetrics | null {
  const grid = section.docGrid
  if (!grid) return null
  // type 未指定は Word では default 扱い。グリッドなし
  if (grid.type === null || grid.type === 'default') return null

  const geometry = pageGeometry(section)
  const textInlinePt = twipToPt(geometry.textInline)
  const textBlockPt = twipToPt(geometry.textBlock)

  const linePitchPt = twipToPt(grid.linePitch)
  const linesPerPage = linePitchPt > 0 ? Math.floor(textBlockPt / linePitchPt) : 0

  const fontSizePt = halfPtToPt(normalSizeHalfPt)
  const charPitchPt = fontSizePt + grid.charSpace / CHAR_SPACE_UNIT
  const charGridEnabled = grid.type === 'linesAndChars' || grid.type === 'snapToChars'
  const charsPerLine =
    charGridEnabled && charPitchPt > 0 ? Math.floor(textInlinePt / charPitchPt) : 0

  return {
    charsPerLine,
    linesPerPage,
    charPitchPt,
    linePitchPt,
    textInlinePt,
    textBlockPt,
    charGridEnabled
  }
}

/**
 * 逆変換。ダイアログで「40 字 × 36 行」と指定されたときの docGrid を求める。
 *
 * charSpace は負にもなりうる (指定文字数が多いほど文字送りは狭くなる)。
 * Word も負の値を書くので、そのまま通す。
 */
export function docGridFor(
  section: SectionProps,
  normalSizeHalfPt: HalfPt,
  charsPerLine: number,
  linesPerPage: number
): NonNullable<SectionProps['docGrid']> {
  const geometry = pageGeometry(section)
  const textInlinePt = twipToPt(geometry.textInline)
  const textBlockPt = twipToPt(geometry.textBlock)

  const linePitchPt = linesPerPage > 0 ? textBlockPt / linesPerPage : twipToPt(360)
  const fontSizePt = halfPtToPt(normalSizeHalfPt)
  const charPitchPt = charsPerLine > 0 ? textInlinePt / charsPerLine : fontSizePt

  return {
    type: charsPerLine > 0 ? 'linesAndChars' : 'lines',
    // 送りは必ず切り下げる。切り上げると指定した行数 / 文字数が 1 つ収まらなくなる
    // (linesPerPage = floor(textBlock / linePitch) なので、pitch が少しでも大きいと減る)
    linePitch: floorToTwip(linePitchPt),
    charSpace: Math.floor((charPitchPt - fontSizePt) * CHAR_SPACE_UNIT)
  }
}

/** pt を twip に切り下げる。1 twip は 1/20 pt */
function floorToTwip(pt: Pt): number {
  return Math.max(1, Math.floor(pt * 20))
}

/** 行数だけを指定する場合 (文字数は標準のまま) */
export function docGridForLinesOnly(
  section: SectionProps,
  linesPerPage: number
): NonNullable<SectionProps['docGrid']> {
  const geometry = pageGeometry(section)
  const textBlockPt = twipToPt(geometry.textBlock)
  const linePitchPt = linesPerPage > 0 ? textBlockPt / linesPerPage : twipToPt(360)
  return { type: 'lines', linePitch: floorToTwip(linePitchPt), charSpace: 0 }
}

/**
 * 指定可能な最大値。Word のダイアログも用紙サイズから上限を出している。
 * 文字が潰れない下限として、文字送りは標準サイズの半分を下回らせない。
 */
export function gridLimits(
  section: SectionProps,
  normalSizeHalfPt: HalfPt
): { maxCharsPerLine: number; maxLinesPerPage: number } {
  const geometry = pageGeometry(section)
  const fontSizePt = halfPtToPt(normalSizeHalfPt)
  const minPitchPt = Math.max(1, fontSizePt / 2)
  return {
    maxCharsPerLine: Math.max(1, Math.floor(twipToPt(geometry.textInline) / minPitchPt)),
    maxLinesPerPage: Math.max(1, Math.floor(twipToPt(geometry.textBlock) / minPitchPt))
  }
}

/**
 * 原稿用紙のマス目の実寸 (px 変換は呼び出し側)。
 * 文字グリッドが無効なら null。
 */
export function manuscriptCell(metrics: GridMetrics | null): { widthPt: Pt; heightPt: Pt } | null {
  if (!metrics || !metrics.charGridEnabled) return null
  return { widthPt: metrics.charPitchPt, heightPt: metrics.linePitchPt }
}

/** 標準スタイルのフォントサイズ。取れなければ日本語 Word の既定 10.5pt */
export const DEFAULT_NORMAL_SIZE: HalfPt = 21

export function normalSizeOf(sizeHalfPt: HalfPt | null | undefined): HalfPt {
  return sizeHalfPt ?? DEFAULT_NORMAL_SIZE
}
