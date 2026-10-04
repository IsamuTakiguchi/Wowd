import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import { collectHeadings, jumpTo, pageStarts } from '../navigate'

/** ジャンプ (Ctrl+G)。ページ番号か見出しを選んで移る */
export function GotoDialog({ editor, onClose }: { editor: Editor; onClose: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<'page' | 'heading'>('page')
  const [page, setPage] = useState('')
  const starts = useMemo(() => pageStarts(editor), [editor])
  const headings = useMemo(() => collectHeadings(editor), [editor])
  const [heading, setHeading] = useState(0)

  const submit = (): void => {
    if (kind === 'page') {
      const raw = page.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      // 「+2」「-1」は今のページからの相対 (Word と同じ)
      const current = starts.filter((p) => p <= editor.state.selection.from).length
      const n = /^[+-]\d+$/.test(raw) ? current + Number(raw) : Number(raw)
      if (!Number.isFinite(n) || n < 1) return
      jumpTo(editor, starts[Math.min(n, starts.length) - 1] ?? 0)
    } else {
      const h = headings[heading]
      if (h) jumpTo(editor, h.pos)
    }
    onClose()
  }

  return (
    <Dialog title="ジャンプ" open onClose={onClose} onSubmit={submit} submitLabel="ジャンプ" width={420}>
      <div className="wowd-dialog-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={kind === 'page'} className={kind === 'page' ? 'is-active' : undefined} onClick={() => setKind('page')}>
          ページ
        </button>
        <button type="button" role="tab" aria-selected={kind === 'heading'} className={kind === 'heading' ? 'is-active' : undefined} onClick={() => setKind('heading')}>
          見出し
        </button>
      </div>
      {kind === 'page' ? (
        <label className="wowd-dialog-field">
          <span>ページ番号 (全 {starts.length} ページ。+2 / -1 で今のページから前後)</span>
          <input autoFocus value={page} data-testid="goto-page" inputMode="numeric" onChange={(e) => setPage(e.target.value)} />
        </label>
      ) : headings.length === 0 ? (
        <p className="wowd-dialog-note">見出し (アウトライン レベルのある段落) がありません。</p>
      ) : (
        <label className="wowd-dialog-field">
          <span>見出し</span>
          <select size={Math.min(10, headings.length)} value={heading} onChange={(e) => setHeading(Number(e.target.value))}>
            {headings.map((h, i) => (
              <option key={h.pos} value={i}>
                {'　'.repeat(h.level)}
                {h.text}
              </option>
            ))}
          </select>
        </label>
      )}
    </Dialog>
  )
}
