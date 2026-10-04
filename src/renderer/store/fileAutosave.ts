import { create } from 'zustand'
import { useDocumentStore } from './document'
import { useTabsStore } from './tabs'
import { useUiStore } from './ui'
import { platform } from '../platform'
import { docxClient } from '../workers/client'

/**
 * 自動保存 (元のファイルへの上書き)。Office の「自動保存」に当たる。
 *
 * 退避 (store/autosave.ts) とは別物で、両方とも動く:
 *   退避     … 利用者のファイルには触れず、落ちたときのために控えを取る。常にオン
 *   自動保存 … 利用者のファイルそのものへ書く。オンにしたときだけ
 *
 * ## いつ書くか
 *
 * 打つのが止まってから AUTOSAVE_DELAY_MS 後。打ち続けている間は待つ。
 * 1 文字ごとに書くと、大きな文書では保存が追いつかず手元が重くなる。
 * 打ち続けて止まらない場合でも、AUTOSAVE_MAX_WAIT_MS を越えたら書く。
 *
 * ## 書かないとき
 *
 * - オフ
 * - まだ保存場所が無い (無題)。どこへ書くかを勝手に決めない
 * - その場所へ尋ねずに上書きできない (ブラウザ版で、保存先の持ち手が無い)。
 *   書けばダウンロードになり、自動保存のたびにファイルが積み上がる
 * - 表示に失敗して保存を止めている
 */

export const AUTOSAVE_DELAY_MS = 2_000
export const AUTOSAVE_MAX_WAIT_MS = 30_000

export type AutoSaveStatus =
  | { kind: 'off' }
  /** 無題。保存すれば以後は自動で書く */
  | { kind: 'needsLocation' }
  /** その場所へは上書きできない */
  | { kind: 'unavailable'; reason: string }
  /** 変更があり、書く順番待ち */
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }

interface AutoSaveState {
  status: AutoSaveStatus
}

export const useAutoSaveStore = create<AutoSaveState>(() => ({ status: { kind: 'off' } }))

function setStatus(status: AutoSaveStatus): void {
  const current = useAutoSaveStore.getState().status
  if (current.kind === status.kind && JSON.stringify(current) === JSON.stringify(status)) return
  useAutoSaveStore.setState({ status })
}

/** いまの画面の文書について、自動保存がどういう状態にあるか */
function evaluate(): AutoSaveStatus | 'eligible' {
  if (!useUiStore.getState().autoSave) return { kind: 'off' }
  const doc = useDocumentStore.getState()
  if (!doc.document) return { kind: 'off' }
  if (doc.saveBlockedReason) return { kind: 'error', message: doc.saveBlockedReason }
  if (!doc.filePath) return { kind: 'needsLocation' }
  if (!platform.canWriteInPlace(doc.filePath)) {
    return {
      kind: 'unavailable',
      reason:
        'このファイルには上書きできません。「名前を付けて保存」で保存先を選ぶと、以後は自動で保存されます'
    }
  }
  return 'eligible'
}

let delayTimer: ReturnType<typeof setTimeout> | null = null
let firstPendingAt: number | null = null
let saving = false
/** 書いている最中に次の変更が来たら、書き終えてからもう一度書く */
let again = false

function clearTimer(): void {
  if (delayTimer !== null) clearTimeout(delayTimer)
  delayTimer = null
}

/** 変更が来たら呼ぶ。打ち続けている間は待ち、止まったら書く */
function schedule(): void {
  const state = evaluate()
  if (state !== 'eligible') {
    clearTimer()
    firstPendingAt = null
    setStatus(state)
    return
  }
  if (!useDocumentStore.getState().dirty) {
    // 変更が無い。最後に書いた時刻を出しておく
    if (useAutoSaveStore.getState().status.kind !== 'saved') {
      setStatus({ kind: 'saved', at: Date.now() })
    }
    return
  }
  if (saving) {
    again = true
    return
  }
  setStatus({ kind: 'pending' })
  const now = Date.now()
  firstPendingAt ??= now
  clearTimer()
  // 打ち続けて止まらない場合でも、最初の変更から一定時間で書く
  const overdue = now - firstPendingAt >= AUTOSAVE_MAX_WAIT_MS
  delayTimer = setTimeout(() => void flush(), overdue ? 0 : AUTOSAVE_DELAY_MS)
}

/** いま書く。書けない状態なら何もしない */
export async function flush(): Promise<boolean> {
  clearTimer()
  if (evaluate() !== 'eligible') return false
  const doc = useDocumentStore.getState()
  if (!doc.dirty || doc.busy) return false
  if (saving) {
    again = true
    return false
  }
  saving = true
  firstPendingAt = null
  setStatus({ kind: 'saving' })
  try {
    const ok = await doc.save()
    setStatus(ok ? { kind: 'saved', at: Date.now() } : { kind: 'error', message: '保存できませんでした' })
    return ok
  } catch (err) {
    setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    return false
  } finally {
    saving = false
    if (again) {
      again = false
      schedule()
    }
  }
}

/**
 * 裏に回したタブを書く。
 *
 * タブを切り替えた瞬間はまだ書けていないことがある (打ってすぐ切り替えたとき)。
 * 裏のタブはもう編集されないので、待たずにその場で書く。
 */
async function flushParked(id: string): Promise<void> {
  if (!useUiStore.getState().autoSave) return
  const data = useTabsStore.getState().parkedData(id)
  if (!data?.dirty || !data.document || !data.sourceBytes || !data.filePath) return
  if (data.saveBlockedReason || !platform.canWriteInPlace(data.filePath)) return
  try {
    const bytes = await docxClient.save(data.document, data.sourceBytes, {
      numberingChanged: data.numberingChanged,
      commentsChanged: data.commentsChanged,
      headersChanged: data.headersChanged,
      tocChanged: data.tocChanged,
      stylesChanged: data.stylesChanged
    })
    await platform.writeFile(data.filePath, bytes)
    // 書いているあいだにそのタブが表に戻っていたら、預かり物はもう無い。
    // その場合は表の文書が「未保存」のまま残り、表の自動保存がもう一度書く
    useTabsStore.getState().updateParked(id, {
      dirty: false,
      numberingChanged: false,
      commentsChanged: false,
      headersChanged: false,
      tocChanged: false,
      stylesChanged: false,
      sourceBytes: bytes
    })
  } catch {
    // 裏で失敗しても、そのタブは「未保存」のまま残る。表に戻したときにもう一度書く
  }
}

/** 自動保存を動かす。止める関数を返す */
export function startFileAutosave(): () => void {
  const unsubscribers: (() => void)[] = []

  // 変更のたびに呼ばれる。markDirty は打鍵のたびに通し番号を進めるので、それを合図にする
  unsubscribers.push(
    useDocumentStore.subscribe((state, prev) => {
      if (
        state.revision !== prev.revision ||
        state.filePath !== prev.filePath ||
        state.dirty !== prev.dirty ||
        state.loadToken !== prev.loadToken
      ) {
        schedule()
      }
    })
  )

  // オン / オフを切り替えたとき
  unsubscribers.push(
    useUiStore.subscribe((state, prev) => {
      if (state.autoSave !== prev.autoSave) schedule()
    })
  )

  // タブを裏へ回したとき。回したタブを待たずに書く
  unsubscribers.push(
    useTabsStore.subscribe((state, prev) => {
      for (const id of state.parked.keys()) {
        if (!prev.parked.has(id)) void flushParked(id)
      }
    })
  )

  // 窓を閉じる・アプリを切り替えるときは待たずに書く
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void flush()
  }
  document.addEventListener('visibilitychange', onHide)
  unsubscribers.push(() => document.removeEventListener('visibilitychange', onHide))

  schedule()
  return () => {
    clearTimer()
    for (const off of unsubscribers) off()
  }
}
