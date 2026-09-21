import { useDocumentStore } from './document'
import { platform } from '../platform'

/**
 * 自動保存。
 *
 * 一定間隔で、未保存の変更があるときだけ退避を書く。
 * 書き出すのは元のファイルではなく userData 配下の複製なので、
 * 利用者のファイルを勝手に上書きすることはない。
 *
 * 退避はアプリが正常終了したときに main 側で消える。
 * 起動時に残っていれば、前回が異常終了したということ。
 */

/** 退避の間隔。短くすると重く、長くすると失う量が増える */
export const AUTOSAVE_INTERVAL_MS = 30_000

let timer: ReturnType<typeof setInterval> | null = null
/** 退避が重なるのを防ぐ。大きな文書では 1 回の書き出しに時間がかかる */
let running = false

/** いま退避すべきなら退避する */
export async function saveRecoveryNow(): Promise<boolean> {
  if (running) return false
  const state = useDocumentStore.getState()
  // 変更が無ければ何もしない。保存を邪魔しないため
  if (!state.dirty || !state.document || state.saveBlockedReason) return false

  running = true
  try {
    const bytes = await state.saveToBytes()
    if (bytes.length === 0) return false
    await platform.saveRecovery(new Uint8Array(bytes), state.filePath, state.fileName())
    return true
  } catch {
    // 退避に失敗しても編集は続けられる。ここで騒ぐ方が害が大きい
    return false
  } finally {
    running = false
  }
}

export function startAutosave(intervalMs = AUTOSAVE_INTERVAL_MS): () => void {
  stopAutosave()
  timer = setInterval(() => void saveRecoveryNow(), intervalMs)
  return stopAutosave
}

export function stopAutosave(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}
