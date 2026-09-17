import { useEffect, useState } from 'react'
import type { RecoveryEntry } from '@shared/ipc'
import { useDocumentStore } from '../store/document'
import { t } from '../i18n/ja'

/**
 * 前回の異常終了から復元する。
 *
 * 自動保存の退避は正常終了時に消える。起動して残っていたら、
 * 前回は落ちたということなので、開くかどうかを尋ねる。
 * 勝手に開くことはしない。手元のファイルより新しいとは限らないため。
 */
export function RecoveryBanner(): React.JSX.Element | null {
  const [entries, setEntries] = useState<RecoveryEntry[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.wowd.listRecovery().then((found) => {
      if (alive) setEntries(found)
    })
    return () => {
      alive = false
    }
  }, [])

  if (entries.length === 0) return null

  const restore = async (entry: RecoveryEntry): Promise<void> => {
    setBusy(true)
    try {
      const bytes = await window.wowd.readRecovery(entry.id)
      if (!bytes) {
        useDocumentStore.getState().setError('復元用のファイルを読めませんでした。')
        return
      }
      // 元のパスは引き継がない。上書き保存で不用意に原本を潰さないため、
      // 保存するときは名前を付けて保存させる
      await useDocumentStore.getState().openBytes(bytes, null)
      setEntries([])
    } finally {
      setBusy(false)
    }
  }

  const discard = async (): Promise<void> => {
    await window.wowd.clearRecovery()
    setEntries([])
  }

  return (
    <div className="banner banner-warn" role="status">
      <div>
        <strong>前回は保存されずに終了しました</strong>
        <div className="banner-detail">
          自動保存された内容が残っています。開くと未保存のまま読み込まれるので、
          内容を確かめてから名前を付けて保存してください。
        </div>
        <div className="recovery-list">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={busy}
              onClick={() => void restore(entry)}
            >
              {entry.name}
              <span className="recovery-time">{formatTime(entry.savedAt)}</span>
            </button>
          ))}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={() => void discard()}>
        {t.dialog.close}
      </button>
    </div>
  )
}

function formatTime(at: number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}
