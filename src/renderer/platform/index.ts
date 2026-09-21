import type { WowdApi } from '@shared/ipc'
import { webPlatform } from './web'

/**
 * 画面側が OS の機能に触る唯一の入口。
 *
 * Electron 版では preload が window.wowd を置く。
 * それが無ければブラウザ版として、ブラウザにあるものだけで賄う実装を使う。
 * 画面側のコードは両者を区別しない。区別するとブラウザ版でしか出ない
 * 不具合が Electron 版のテストに映らなくなる。
 */
const native = (window as { wowd?: WowdApi }).wowd

export const platform: WowdApi = native ?? webPlatform

/** Electron の中で動いているか。メニューの有無など、見せ方だけを変える判断に使う */
export const isElectron = native != null
