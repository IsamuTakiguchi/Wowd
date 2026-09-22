import { useSyncExternalStore } from 'react'

/**
 * 画面の広さの段階。
 *
 *   compact … スマホ。リボンを畳んで上下のバーにする
 *   medium  … タブレットの縦、半分にした窓。リボンは出すが詰める
 *   full    … 普通のパソコンの窓
 *
 * **幅だけで決めない。** スマホを横に倒すと幅は 844px あるが高さは 390px しかなく、
 * リボン (92px) とステータスバーを載せると本文が数行しか残らない。
 * 高さも見て、低くて狭ければ compact にする。
 * タブレットの横 (1024x768) は高さがあるので medium に残る。
 */
export type LayoutSize = 'compact' | 'medium' | 'full'

/** スマホの幅 */
const COMPACT = '(max-width: 720px)'
/** 倒したスマホ。タブレットの横を巻き込まないよう幅にも上限を付ける */
const SHORT = '(max-height: 520px) and (max-width: 1000px)'
/** タブレットの縦、半分にした窓 */
const MEDIUM = '(max-width: 1100px)'

const QUERIES = [COMPACT, SHORT, MEDIUM]

function read(): LayoutSize {
  if (typeof window === 'undefined' || !window.matchMedia) return 'full'
  if (window.matchMedia(COMPACT).matches || window.matchMedia(SHORT).matches) return 'compact'
  if (window.matchMedia(MEDIUM).matches) return 'medium'
  return 'full'
}

function subscribe(onChange: () => void): () => void {
  const lists = QUERIES.map((q) => window.matchMedia(q))
  for (const list of lists) list.addEventListener('change', onChange)
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange)
  }
}

export function useLayoutSize(): LayoutSize {
  return useSyncExternalStore(subscribe, read, () => 'full')
}

/**
 * スマホ用の画面にするか。
 *
 * 判定は幅と高さで行う。「指で押す端末か」で分けると、
 * タブレットの横向きでリボンが消えて困る。
 */
export function useIsMobile(): boolean {
  return useLayoutSize() === 'compact'
}
