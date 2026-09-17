import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog, Field } from './Dialog'
import { ptToHalfPt, halfPtToPt } from '@shared/units'

/**
 * ルビ (ふりがな) の挿入と編集。
 *
 * 選択範囲をベース文字にして読みを入力する。
 * すでにルビが付いている位置にカーソルがあれば、その読みを編集する。
 */
export function RubyDialog({
  editor,
  open,
  onClose
}: {
  editor: Editor | null
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  if (!open || !editor) return null
  // 開くたびに作り直す。開いた瞬間の選択範囲を初期値にでき、
  // その後の選択の変化には追従しない
  return <RubyForm editor={editor} onClose={onClose} />
}

function RubyForm({
  editor,
  onClose
}: {
  editor: Editor
  onClose: () => void
}): React.JSX.Element {
  const existing = editor.isActive('ruby') ? editor.getAttributes('ruby') : null

  const [initial] = useState(() => {
    if (existing) {
      const hps = existing['hps'] as number | null
      return {
        base: editor.state.selection.$from.parent.textContent,
        reading: String(existing['rt'] ?? ''),
        size: hps != null ? halfPtToPt(hps) : 5
      }
    }
    const { from, to } = editor.state.selection
    return { base: editor.state.doc.textBetween(from, to, ''), reading: '', size: 5 }
  })

  const [base, setBase] = useState(initial.base)
  const [reading, setReading] = useState(initial.reading)
  const [size, setSize] = useState(initial.size)

  const canSubmit = base.trim().length > 0 && reading.trim().length > 0

  const submit = (): void => {
    if (!canSubmit) return

    if (existing) {
      editor
        .chain()
        .focus()
        .updateAttributes('ruby', { rt: reading, hps: ptToHalfPt(size) })
        .run()
    } else {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'ruby',
          attrs: {
            rt: reading,
            rubyAlign: 'distributeSpace',
            hps: ptToHalfPt(size),
            hpsRaise: null,
            hpsBaseText: null,
            lid: 'ja-JP',
            rtProps: null
          },
          content: [{ type: 'text', text: base }]
        })
        .run()
    }
    onClose()
  }

  return (
    <Dialog
      title={existing ? 'ルビの編集' : 'ルビの挿入'}
      open
      onClose={onClose}
      onSubmit={submit}
      submitDisabled={!canSubmit}
    >
      <Field label="対象の文字列">
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          readOnly={Boolean(existing)}
          data-testid="ruby-base"
        />
      </Field>
      <Field label="ふりがな">
        <input
          value={reading}
          autoFocus
          onChange={(e) => setReading(e.target.value)}
          data-testid="ruby-reading"
        />
      </Field>
      <Field label="ふりがなのサイズ (pt)">
        <input
          type="number"
          min={3}
          max={20}
          step={0.5}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
      </Field>
      <div className="wowd-dialog-preview">
        プレビュー:{' '}
        <ruby>
          {base || '対象'}
          <rt style={{ fontSize: `${size}pt` }}>{reading || 'よみ'}</rt>
        </ruby>
      </div>
    </Dialog>
  )
}
