import { useDocumentStore } from './document'
import { useTabsStore } from './tabs'
import { platform } from '../platform'
import { docxClient } from '../workers/client'

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

/**
 * いま退避すべきなら退避する。**開いているタブすべて**について。
 *
 * 裏に回したタブも、未保存なら落ちたときに失われる。表の文書だけ退避していると、
 * 3 枚開いて 2 枚目を編集しているときに落ちると、1 枚目と 3 枚目の編集が消える。
 *
 * 退避の枠はタブの id で分ける。未保存の文書 (無題) が何枚あっても重ならない。
 */
export async function saveRecoveryNow(): Promise<boolean> {
  if (running) return false
  running = true
  let wrote = false
  try {
    const tabs = useTabsStore.getState()

    // 表の文書。最新の本文はエディタにあるので saveToBytes で拾う
    const state = useDocumentStore.getState()
    if (state.dirty && state.document && !state.saveBlockedReason) {
      const bytes = await state.saveToBytes()
      if (bytes.length > 0) {
        await platform.saveRecovery(
          new Uint8Array(bytes),
          state.filePath,
          state.fileName(),
          tabs.activeId
        )
        wrote = true
      }
    }

    // 裏のタブ。預けるときに最新の本文を拾ってあるので、そのまま書き出せる
    for (const [id, entry] of tabs.parked) {
      const data = entry.data
      if (!data.dirty || !data.document || !data.sourceBytes || data.saveBlockedReason) continue
      const bytes = await docxClient.save(data.document, data.sourceBytes, {
        numberingChanged: data.numberingChanged,
        commentsChanged: data.commentsChanged,
        headersChanged: data.headersChanged,
        tocChanged: data.tocChanged
      })
      const name = data.filePath
        ? (data.filePath.split(/[\\/]/).pop() ?? data.filePath)
        : (data.untitledName ?? '無題')
      await platform.saveRecovery(bytes, data.filePath, name, id)
      wrote = true
    }
    return wrote
  } catch {
    // 退避に失敗しても編集は続けられる。ここで騒ぐ方が害が大きい
    return wrote
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
