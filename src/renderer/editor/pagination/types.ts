import type { SectionProps } from '@core/model/types'
import type { PageGeometryPx } from '@core/layout/pageGeometry'

/** ページ間の視覚的な隙間 (px)。用紙の影が見える程度 */
export const PAGE_GAP = 24

export interface PageInfo {
  /** 0 始まりの通し番号 */
  index: number
  /** ヘッダー / フッターのフィールドに出す番号 (pgNumType.start を反映した 1 始まり) */
  displayNumber: number
  /** スクロール座標系での用紙の上端 (px) */
  top: number
  /** このページが属するセクション */
  section: SectionProps
}

export interface PageBreakPoint {
  /** 改ページを差し込む ProseMirror の位置 */
  pos: number
  /** 差し込むスペーサーの高さ (px) */
  height: number
}

export interface PageLayout {
  pages: PageInfo[]
  breaks: PageBreakPoint[]
  geometry: PageGeometryPx
  /** 用紙 1 枚ぶんの送り (用紙高 + 隙間) */
  stride: number
  /**
   * 1 ページに収まらず紙からはみ出したブロックの数。
   *
   * 表はページ間で分割しないので、長い表でこれが起きる。
   * 黙って溢れさせると「Wowd が表を壊した」に見えるので、画面で知らせる。
   */
  overflow: { tables: number; others: number }
}

export const EMPTY_LAYOUT: PageLayout = {
  pages: [],
  breaks: [],
  geometry: {
    pageInline: 0,
    pageBlock: 0,
    textInline: 0,
    textBlock: 0,
    marginBefore: 0,
    marginAfter: 0,
    marginStart: 0,
    marginEnd: 0,
    headerOffset: 0,
    footerOffset: 0
  },
  stride: 0,
  overflow: { tables: 0, others: 0 }
}
