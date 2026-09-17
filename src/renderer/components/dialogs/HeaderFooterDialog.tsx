import { useState } from 'react'
import type { Justification } from '@core/model/types'
import {
  toEditableText,
  fromEditableText,
  PAGE_TOKEN,
  PAGES_TOKEN,
  TAB_TOKEN
} from '@core/headerFooter'
import { Dialog, Field } from './Dialog'
import { useDocumentStore } from '../../store/document'
import {
  ensureHeaderFooter,
  type HeaderFooterKind,
  type HeaderFooterSlot
} from '../../editor/commands/headerFooter'

/**
 * ヘッダーとフッターの編集。
 *
 * 中身は本文と同じブロックの並びなので何でも入りうるが、実際のヘッダーは
 * ほぼ「1〜2 行の文字列とページ番号」なので、平文 + 差し込みトークンで扱う。
 *
 * 表や画像を含む凝ったヘッダーは平文に落とせないので編集させない。
 * 無理に潰すと、開いて保存しただけでヘッダーの中身が消えてしまう。
 */
export function HeaderFooterDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const document_ = useDocumentStore((s) => s.document)
  if (!open || !document_) return null
  // 開くたびに作り直す。開いた瞬間の内容を初期値にできる
  return <HeaderFooterForm onClose={onClose} />
}

const SLOTS: { value: HeaderFooterSlot; label: string }[] = [
  { value: 'default', label: 'すべてのページ' },
  { value: 'first', label: '先頭ページ' },
  { value: 'even', label: '偶数ページ' }
]

function HeaderFooterForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const document_ = useDocumentStore((s) => s.document)
  const updateHeaderFooter = useDocumentStore((s) => s.updateHeaderFooter)
  const updateSection = useDocumentStore((s) => s.updateSection)

  const [slot, setSlot] = useState<HeaderFooterSlot>('default')
  const section = document_?.resources.sections[0] ?? null

  const relIdOf = (kind: HeaderFooterKind): string | undefined =>
    (kind === 'header' ? section?.headerRefs : section?.footerRefs)?.[slot]

  const contentOf = (kind: HeaderFooterKind) => {
    const relId = relIdOf(kind)
    const store = kind === 'header' ? document_?.resources.headers : document_?.resources.footers
    return relId ? (store?.get(relId) ?? null) : null
  }

  const header = toEditableText(contentOf('header'))
  const footer = toEditableText(contentOf('footer'))

  // 枠を切り替えたら入力も作り直す。key で再マウントさせるのが一番確実
  return (
    <Dialog title="ヘッダーとフッター" open onClose={onClose} width={520}>
      <Field label="対象">
        <select value={slot} onChange={(e) => setSlot(e.target.value as HeaderFooterSlot)}>
          {SLOTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {slot === 'first' && !section?.titlePg && (
        <p className="wowd-dialog-note">
          先頭ページ別のヘッダーを作ると「先頭ページのみ別」が有効になります。
        </p>
      )}

      <PartEditor
        key={`header-${slot}`}
        kind="header"
        label="ヘッダー"
        initial={header}
        onSave={(text, jc) => save('header', text, jc)}
      />
      <PartEditor
        key={`footer-${slot}`}
        kind="footer"
        label="フッター"
        initial={footer}
        onSave={(text, jc) => save('footer', text, jc)}
      />
    </Dialog>
  )

  function save(kind: HeaderFooterKind, text: string, jc: Justification | null): void {
    if (!document_ || !section) return
    const result = ensureHeaderFooter(document_, section, kind, slot)
    if (result.created) {
      // 参照を足したセクションに差し替える。差し替えないと画面に出ない
      updateSection(0, () => result.section)
    }
    updateHeaderFooter(kind, result.relId, fromEditableText(text, jc))
  }
}

const ALIGNMENTS: { value: string; label: string }[] = [
  { value: '', label: '既定' },
  { value: 'left', label: '左' },
  { value: 'center', label: '中央' },
  { value: 'right', label: '右' }
]

function PartEditor({
  kind,
  label,
  initial,
  onSave
}: {
  kind: HeaderFooterKind
  label: string
  initial: { text: string; jc: Justification | null } | null
  onSave: (text: string, jc: Justification | null) => void
}): React.JSX.Element {
  const [text, setText] = useState(initial?.text ?? '')
  const [jc, setJc] = useState<string>(initial?.jc ?? '')
  const [saved, setSaved] = useState(false)

  if (!initial) {
    return (
      <div className="wowd-dialog-section">
        <strong>{label}</strong>
        <p className="wowd-dialog-note">
          表や画像を含むため、ここでは編集できません。内容はそのまま保存されます。
        </p>
      </div>
    )
  }

  const insert = (token: string): void => {
    setText((current) => current + token)
    setSaved(false)
  }

  return (
    <div className="wowd-dialog-section">
      <strong>{label}</strong>
      <textarea
        rows={3}
        value={text}
        data-testid={`${kind}-text`}
        onChange={(e) => {
          setText(e.target.value)
          setSaved(false)
        }}
      />
      <div className="wowd-dialog-row">
        <select
          value={jc}
          title={`${label}の配置`}
          onChange={(e) => {
            setJc(e.target.value)
            setSaved(false)
          }}
        >
          {ALIGNMENTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid={`${kind}-insert-page`}
          onClick={() => insert(PAGE_TOKEN)}
        >
          ページ番号
        </button>
        <button
          type="button"
          data-testid={`${kind}-insert-pages`}
          onClick={() => insert(PAGES_TOKEN)}
        >
          総ページ数
        </button>
        <button type="button" data-testid={`${kind}-insert-tab`} onClick={() => insert(TAB_TOKEN)}>
          タブ
        </button>
        <button
          type="button"
          className="is-primary"
          data-testid={`${kind}-apply`}
          onClick={() => {
            onSave(text, (jc || null) as Justification | null)
            setSaved(true)
          }}
        >
          {saved ? '適用済み' : '適用'}
        </button>
      </div>
    </div>
  )
}
