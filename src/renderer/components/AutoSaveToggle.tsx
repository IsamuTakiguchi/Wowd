import { useUiStore } from '../store/ui'
import { useDocumentStore } from '../store/document'
import { useAutoSaveStore, type AutoSaveStatus } from '../store/fileAutosave'

/**
 * 自動保存の切り替え。Office と同じく、窓の左上に置く。
 *
 * 無題の文書でオンにしたときは、その場で保存場所を尋ねる (Office と同じ)。
 * どこへ書くかを勝手に決めないため。取り消してもオンのまま残し、
 * 保存した時点から自動で書き始める。
 */
export function AutoSaveToggle({ variant = 'bar' }: { variant?: 'bar' | 'menu' }): React.JSX.Element {
  const on = useUiStore((s) => s.autoSave)
  const toggle = useUiStore((s) => s.toggleAutoSave)
  const status = useAutoSaveStore((s) => s.status)
  const hasLocation = useDocumentStore((s) => s.filePath !== null)

  const flip = (): void => {
    const next = !on
    toggle(next)
    if (next && !hasLocation) void useDocumentStore.getState().saveAs()
  }

  const label = statusLabel(on ? status : { kind: 'off' })

  return (
    <div className={`autosave autosave-${variant}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={on ? 'autosave-switch is-on' : 'autosave-switch'}
        title={
          on
            ? '自動保存はオンです。編集が止まって少したつと、元のファイルへ上書きします'
            : '自動保存はオフです。オンにすると、編集のたびに元のファイルへ上書きします'
        }
        data-testid="autosave-toggle"
        onClick={flip}
      >
        <span className="autosave-name">自動保存</span>
        <span className="autosave-track" aria-hidden="true">
          <span className="autosave-thumb" />
        </span>
        <span className="autosave-state">{on ? 'オン' : 'オフ'}</span>
      </button>
      {label && (
        <span
          className={`autosave-status is-${on ? status.kind : 'off'}`}
          title={status.kind === 'unavailable' || status.kind === 'error' ? statusDetail(status) : undefined}
          data-testid="autosave-status"
          aria-live="polite"
        >
          {label}
        </span>
      )}
    </div>
  )
}

function statusLabel(status: AutoSaveStatus): string | null {
  switch (status.kind) {
    case 'off':
      return null
    case 'needsLocation':
      return '保存すると自動保存が始まります'
    case 'unavailable':
      return 'この場所には自動保存できません'
    case 'pending':
      return '変更あり'
    case 'saving':
      return '保存中…'
    case 'saved':
      return '保存済み'
    case 'error':
      return '保存できませんでした'
  }
}

function statusDetail(status: AutoSaveStatus): string {
  if (status.kind === 'unavailable') return status.reason
  if (status.kind === 'error') return status.message
  return ''
}
