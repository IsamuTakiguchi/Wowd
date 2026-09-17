import { useEffect, useRef, type ReactNode } from 'react'
import { t } from '../../i18n/ja'

/**
 * モーダルダイアログの共通枠。
 *
 * <dialog> を使うと Esc での取り消しとフォーカストラップが標準で付いてくる。
 * 自前で実装するより挙動が正しく、キーボード操作も期待どおりになる。
 */
export function Dialog({
  title,
  open,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled = false,
  children,
  width = 420
}: {
  title: string
  open: boolean
  onClose: () => void
  onSubmit?: () => void
  submitLabel?: string
  submitDisabled?: boolean
  children: ReactNode
  width?: number
}): React.JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={ref}
      className="wowd-dialog"
      style={{ width }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit?.()
        }}
      >
        <div className="wowd-dialog-header">{title}</div>
        <div className="wowd-dialog-body">{children}</div>
        <div className="wowd-dialog-footer">
          <button type="button" onClick={onClose}>
            {t.dialog.cancel}
          </button>
          {onSubmit && (
            <button type="submit" className="is-primary" disabled={submitDisabled}>
              {submitLabel ?? t.dialog.ok}
            </button>
          )}
        </div>
      </form>
    </dialog>
  )
}

export function Field({
  label,
  children
}: {
  label: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="wowd-dialog-field">
      <span>{label}</span>
      {children}
    </label>
  )
}
