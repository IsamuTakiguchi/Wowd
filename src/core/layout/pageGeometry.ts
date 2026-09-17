/**
 * ページの幾何計算。DOM にも Electron にも依存しない純粋関数だけを置く。
 *
 * 単位は OOXML ネイティブの twip のまま扱い、px への変換は描画直前に行う。
 *
 * 計算はすべて論理方向 (inline / block) で書く。v1 は横書きだけだが、
 * 縦書きを足すときにここの式を書き換えずに済む。いま何のコストも掛からない。
 */
import type { SectionProps, Twip } from '../model/types'
import { twipToPt, PX_PER_PT } from '../../shared/units'

export interface PageGeometry {
  /** 用紙全体 */
  pageInline: Twip
  pageBlock: Twip
  /** 本文が入る領域 (余白を除いた部分) */
  textInline: Twip
  textBlock: Twip
  /** 余白 */
  marginBefore: Twip
  marginAfter: Twip
  marginStart: Twip
  marginEnd: Twip
  /** ヘッダー / フッターを置く位置 (用紙の端からの距離) */
  headerOffset: Twip
  footerOffset: Twip
}

/**
 * セクション設定からページ幾何を求める。
 *
 * 綴じ代 (w:gutter) は本文領域を狭める。Word と同じく開始側に寄せる。
 */
export function pageGeometry(section: SectionProps): PageGeometry {
  const { pgSz, pgMar } = section
  const marginStart = pgMar.left + pgMar.gutter
  const marginEnd = pgMar.right

  return {
    pageInline: pgSz.w,
    pageBlock: pgSz.h,
    textInline: Math.max(0, pgSz.w - marginStart - marginEnd),
    textBlock: Math.max(0, pgSz.h - pgMar.top - pgMar.bottom),
    marginBefore: pgMar.top,
    marginAfter: pgMar.bottom,
    marginStart,
    marginEnd,
    headerOffset: pgMar.header,
    footerOffset: pgMar.footer
  }
}

/** twip を CSS px に直す。描画層だけが使う */
export function twipToCssPx(v: Twip): number {
  return twipToPt(v) * PX_PER_PT
}

export interface PageGeometryPx {
  pageInline: number
  pageBlock: number
  textInline: number
  textBlock: number
  marginBefore: number
  marginAfter: number
  marginStart: number
  marginEnd: number
  headerOffset: number
  footerOffset: number
}

export function toPx(geometry: PageGeometry): PageGeometryPx {
  return {
    pageInline: twipToCssPx(geometry.pageInline),
    pageBlock: twipToCssPx(geometry.pageBlock),
    textInline: twipToCssPx(geometry.textInline),
    textBlock: twipToCssPx(geometry.textBlock),
    marginBefore: twipToCssPx(geometry.marginBefore),
    marginAfter: twipToCssPx(geometry.marginAfter),
    marginStart: twipToCssPx(geometry.marginStart),
    marginEnd: twipToCssPx(geometry.marginEnd),
    headerOffset: twipToCssPx(geometry.headerOffset),
    footerOffset: twipToCssPx(geometry.footerOffset)
  }
}

/**
 * ページ番号に使うヘッダー / フッターの種別を決める。
 *
 * Word の規則:
 *   titlePg が真なら 1 ページ目は first
 *   evenAndOddHeaders が有効で偶数ページなら even
 *   それ以外は default
 *
 * 指定された種別が無ければ default に落ちる (Word も同じ)。
 *
 * @param pageNumber 1 始まりの、文書全体でのページ番号
 */
export function pickHeaderFooterRef(
  refs: { default?: string; first?: string; even?: string },
  pageNumber: number,
  titlePg: boolean,
  evenAndOdd: boolean
): string | null {
  if (titlePg && pageNumber === 1 && refs.first) return refs.first
  if (evenAndOdd && pageNumber % 2 === 0 && refs.even) return refs.even
  return refs.default ?? null
}
