import { useSyncExternalStore } from 'react'

/**
 * スマホの寸法かどうか。
 *
 * 720px より狭ければスマホ用の画面 (上下のバーだけ、リボン無し) に切り替える。
 * Electron 版は窓の最小幅が 800px なので、ここが真になることはない。
 * つまりスマホ用の画面はブラウザ版でしか出ない。
 *
 * 判定は幅だけで行う。「指で押す端末か」で分けると、
 * タブレットの横向きでリボンが消えて困る。
 */
const QUERY = '(max-width: 720px)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function read(): boolean {
  return window.matchMedia(QUERY).matches
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
