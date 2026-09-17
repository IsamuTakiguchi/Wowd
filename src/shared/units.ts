/**
 * OOXML のネイティブ単位と CSS 単位の相互変換。
 *
 * 方針: モデルは常に OOXML ネイティブ単位 (twip / half-point / EMU) で値を保持し、
 * px への変換はレンダリング直前だけで行う。途中で px に落とすと丸め誤差が
 * そのままラウンドトリップの差分になる。
 */

/** 1/20 ポイント。w:ind, w:spacing, w:pgSz, w:pgMar などで使われる */
export type Twip = number
/** 1/2 ポイント。w:sz (フォントサイズ) で使われる。21 = 10.5pt = 日本語 Word の既定 */
export type HalfPt = number
/** English Metric Unit。1 インチ = 914400。画像サイズで使われる */
export type Emu = number
export type Pt = number

export const TWIP_PER_PT = 20
export const TWIP_PER_INCH = 1440
export const EMU_PER_PT = 12700
export const EMU_PER_INCH = 914400
export const EMU_PER_TWIP = 635
/** CSS の 1pt = 1/72in、1px = 1/96in。ブラウザの論理 px との比 */
export const PX_PER_PT = 96 / 72

export const twipToPt = (v: Twip): Pt => v / TWIP_PER_PT
export const ptToTwip = (v: Pt): Twip => Math.round(v * TWIP_PER_PT)
export const twipToPx = (v: Twip): number => (v / TWIP_PER_PT) * PX_PER_PT
export const twipToMm = (v: Twip): number => (v / TWIP_PER_INCH) * 25.4
export const mmToTwip = (v: number): Twip => Math.round((v / 25.4) * TWIP_PER_INCH)

export const halfPtToPt = (v: HalfPt): Pt => v / 2
export const ptToHalfPt = (v: Pt): HalfPt => Math.round(v * 2)

export const emuToPt = (v: Emu): Pt => v / EMU_PER_PT
export const ptToEmu = (v: Pt): Emu => Math.round(v * EMU_PER_PT)
export const emuToPx = (v: Emu): number => (v / EMU_PER_PT) * PX_PER_PT
export const emuToTwip = (v: Emu): Twip => Math.round(v / EMU_PER_TWIP)
export const twipToEmu = (v: Twip): Emu => v * EMU_PER_TWIP
