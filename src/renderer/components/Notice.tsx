import { useUiStore } from '../store/ui'

/** 画面下に数秒だけ出る知らせ。操作の結果 (「設定しました」など) を伝える */
export function Notice(): React.JSX.Element | null {
  const notice = useUiStore((s) => s.notice)
  const notify = useUiStore((s) => s.notify)
  if (!notice) return null
  return (
    <div className="notice" role="status" data-testid="notice" onClick={() => notify(null)}>
      {notice}
    </div>
  )
}
