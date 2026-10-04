import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { REL_TYPE } from '@core/docx/package'
import type { RelationshipTable } from '@core/model/types'
import { Dialog } from '../../components/dialogs/Dialog'
import { useDocumentStore } from '../../store/document'

/** リンクにしてよい行き先。ファイルやスクリプトは受け付けない */
export function normalizeUrl(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (/^(https?:\/\/|mailto:)/i.test(s)) return s
  if (/^www\./i.test(s)) return `https://${s}`
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`
  return null
}

/** 外部リンクの関係を足して、その rId を返す */
function addHyperlinkRel(rels: RelationshipTable, target: string): string {
  const id = `rId${rels.nextId}`
  rels.nextId += 1
  rels.byId.set(id, { id, type: REL_TYPE.hyperlink, target, targetMode: 'External' })
  return id
}

/**
 * ハイパーリンクの挿入・編集 (Ctrl+K)。
 *
 * 行き先は Word と同じく関係 (.rels) に入れ、本文には r:id だけを書く。
 * Wowd の画面ではリンクを踏ませない (受け取った文書のリンクを誤って開かないため)。
 */
export function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }): React.JSX.Element {
  const document = useDocumentStore((s) => s.document)
  const existing = editor.getAttributes('link') as { rId?: string | null; href?: string | null }
  const existingTarget =
    existing.href ?? (existing.rId ? (document?.resources.rels.byId.get(existing.rId)?.target ?? '') : '')
  const { from, to, empty } = editor.state.selection
  const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
  const [text, setText] = useState(selected)
  const [url, setUrl] = useState(existingTarget ?? '')
  const target = normalizeUrl(url)
  const isEditing = existing.rId != null || existing.href != null

  const submit = (): void => {
    const current = useDocumentStore.getState().document
    if (!target || !current) return
    const id = addHyperlinkRel(current.resources.rels, target)
    const attrs = { href: target, rId: id, anchor: null, tooltip: null }
    if (empty && !isEditing) {
      const label = text.trim() || target.replace(/^mailto:/, '')
      editor.chain().focus().insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs }] }).run()
    } else if (isEditing) {
      editor.chain().focus().extendMarkRange('link').setMark('link', attrs).run()
    } else {
      editor.chain().focus().setMark('link', attrs).run()
    }
    useDocumentStore.getState().markDirty()
    onClose()
  }

  const remove = (): void => {
    editor.chain().focus().extendMarkRange('link').unsetMark('link').run()
    onClose()
  }

  return (
    <Dialog
      title={isEditing ? 'ハイパーリンクの編集' : 'ハイパーリンクの挿入'}
      open
      onClose={onClose}
      onSubmit={submit}
      submitDisabled={!target}
      width={460}
    >
      {!isEditing && (
        <label className="wowd-dialog-field">
          <span>表示文字列</span>
          <input value={text} data-testid="link-text" disabled={!empty} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      <label className="wowd-dialog-field">
        <span>アドレス (https://… または メールアドレス)</span>
        <input autoFocus value={url} data-testid="link-url" onChange={(e) => setUrl(e.target.value)} />
      </label>
      {url.trim() && !target && (
        <p className="wowd-dialog-note wowd-dialog-error">https:// で始まるアドレスか、メールアドレスを入れてください。</p>
      )}
      {isEditing && (
        <div className="wowd-dialog-row">
          <button type="button" data-testid="link-remove" onClick={remove}>
            リンクの解除
          </button>
        </div>
      )}
    </Dialog>
  )
}
