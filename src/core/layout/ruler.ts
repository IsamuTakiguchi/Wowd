/**
 * ルーラ (目盛り) の計算。DOM にも Electron にも依存しない純粋関数だけを置く。
 *
 * 目盛りの原点は**本文領域の左端**に置く。用紙の端ではない。
 * Word もそうで、書いている人が見たいのは「余白からどれだけ字下げしたか」であって
 * 「紙の端からの距離」ではないため。余白の中は数字が戻っていく (3, 2, 1, 0)。
 *
 * 単位は mm。日本語 Word の既定は「字」だが、字の幅は書体と級数で変わるので、
 * 紙に出たときの長さと一致しない。裁ちトンボと同じ mm にそろえておくと、
 * 入稿するときに読み替えが要らない。
 */
import type { Twip } from '../model/types'
import { mmToTwip, twipToMm } from '../../shared/units'
import type { ParagraphIndent } from '../model/types'

export interface RulerTick {
  /** 用紙の端からの距離 (twip) */
  at: Twip
  /** 数字を出す目盛りか */
  major: boolean
  /** 数字。本文領域の左端を 0 とした mm の絶対値。minor では null */
  label: number | null
}

export interface RulerModel {
  /** 用紙の長さ (twip) */
  length: Twip
  /** 本文領域の始まりと終わり (用紙の端からの twip) */
  textStart: Twip
  textEnd: Twip
  ticks: RulerTick[]
}

export interface RulerOptions {
  length: Twip
  textStart: Twip
  textEnd: Twip
  /** 数字を出す間隔 (mm) */
  majorMm?: number
  /** 細かい目盛りの間隔 (mm) */
  minorMm?: number
}

/**
 * 目盛りを並べる。
 *
 * 本文領域の左端から左右へ minorMm 刻みで置き、majorMm の倍数には数字を付ける。
 * 用紙からはみ出すものは落とす。
 */
export function rulerTicks(options: RulerOptions): RulerModel {
  const majorMm = options.majorMm ?? 10
  const minorMm = options.minorMm ?? 5
  const step = mmToTwip(minorMm)
  const perMajor = Math.max(1, Math.round(majorMm / minorMm))

  const ticks: RulerTick[] = []
  // 原点から右へ、次に左へ。0 を二重に入れない
  for (let i = 0; ; i++) {
    const at = options.textStart + step * i
    if (at > options.length) break
    ticks.push(tick(at, i, perMajor, minorMm))
  }
  for (let i = 1; ; i++) {
    const at = options.textStart - step * i
    if (at < 0) break
    ticks.push(tick(at, i, perMajor, minorMm))
  }
  ticks.sort((a, b) => a.at - b.at)

  return { length: options.length, textStart: options.textStart, textEnd: options.textEnd, ticks }
}

function tick(at: Twip, i: number, perMajor: number, minorMm: number): RulerTick {
  const major = i % perMajor === 0
  // 数字は原点からの距離。左側も符号を付けずに出す (Word と同じ)
  return { at, major, label: major ? Math.round(i * minorMm) : null }
}

export interface IndentMarkers {
  /** 1 行目の書き出し位置 (用紙の端からの twip) */
  firstLine: Twip
  /** 2 行目以降の書き出し位置 */
  left: Twip
  /** 右端 */
  right: Twip
}

/**
 * 段落の字下げから、ルーラに置く三角の位置を求める。
 *
 * Word の規則:
 *   left      本文領域の左端からの字下げ
 *   firstLine 1 行目だけ、left からさらに右へ
 *   hanging   1 行目だけ、left から左へ (firstLine と排他)
 *   right     本文領域の右端からの字下げ
 *
 * leftChars などの「文字単位」の指定がある文書ではそちらが優先される
 * (日本語 Word が書く形)。1 文字ぶんの幅を emWidth で渡すこと。
 */
export function indentMarkers(
  ind: ParagraphIndent | null,
  area: { textStart: Twip; textEnd: Twip },
  emWidth: Twip
): IndentMarkers {
  const chars = (v: number | undefined): Twip | null =>
    v == null ? null : Math.round((v / 100) * emWidth)

  const left = chars(ind?.leftChars) ?? ind?.left ?? 0
  const right = chars(ind?.rightChars) ?? ind?.right ?? 0
  const firstLine = chars(ind?.firstLineChars) ?? ind?.firstLine ?? 0
  const hanging = chars(ind?.hangingChars) ?? ind?.hanging ?? 0

  const leftPos = area.textStart + left
  return {
    left: leftPos,
    // ぶら下げと 1 行目の字下げは排他だが、両方あっても破綻しないよう足し引きで扱う
    firstLine: leftPos + firstLine - hanging,
    right: area.textEnd - right
  }
}

/**
 * ルーラ上の位置を段落の字下げに翻訳する。三角をつかんで動かしたときに使う。
 *
 * 動かせる量は本文領域の中に限る。紙の外に字下げしても Word で開けば戻されるだけで、
 * 途中の状態を作っても得がない。
 *
 * 返すのは twip の差分。文字単位の文書では呼び出し側が文字に直す。
 */
export function indentFromPosition(
  handle: 'firstLine' | 'left' | 'right',
  at: Twip,
  area: { textStart: Twip; textEnd: Twip },
  current: IndentMarkers
): Twip {
  const width = area.textEnd - area.textStart
  if (handle === 'right') {
    // 右の三角。左の書き出しより左には行けない
    const clamped = clamp(at, Math.max(current.left, current.firstLine), area.textEnd)
    return area.textEnd - clamped
  }
  const clamped = clamp(at, area.textStart - width, area.textEnd)
  return clamped - area.textStart
}

/**
 * 目盛りに吸い付かせる。刻みは既定 0.5mm。
 *
 * 丸めは mm の側で行う。0.5mm は 28.35twip で割り切れないので、
 * twip に直した刻みで丸めると 1 目盛りごとに誤差が積もる。
 */
export function snapToRuler(at: Twip, stepMm = 0.5): Twip {
  const steps = Math.round(twipToMm(at) / stepMm)
  return mmToTwip(steps * stepMm)
}

/** 画面に出すための mm 表記。小数 1 桁まで */
export function formatMm(v: Twip): string {
  return `${Math.round(twipToMm(v) * 10) / 10}mm`
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
