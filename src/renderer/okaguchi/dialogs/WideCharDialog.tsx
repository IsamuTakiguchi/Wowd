import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import { wideOneChar } from '@core/okaguchi/wideChar'
import { insertRuns } from '../insert'
import { Check } from './common'

/**
 * 全角1文字入力 (Alt+Z)。(1) (a) (ｱ) を、括弧を半分の幅にして全角 1 字分に収める。
 */
export function WideCharDialog({ editor, onClose }: { editor: Editor | null; onClose: () => void }): React.JSX.Element {
  const [input, setInput] = useState('')
  const [noSpace, setNoSpace] = useState(false)
  const [fit, setFit] = useState(false)
  const runs = wideOneChar(input, { noSpace, fit })

  const submit = (): void => {
    if (!editor || runs.length === 0) return
    insertRuns(editor, runs)
    onClose()
  }

  return (
    <Dialog title="全角1文字入力" open onClose={onClose} onSubmit={submit} submitDisabled={runs.length === 0} width={440}>
      <label className="wowd-dialog-field">
        <span>カッコ内に挿入したい文字 (全角でも半角でも構いません)</span>
        <input autoFocus value={input} data-testid="okaguchi-wide-input" onChange={(e) => setInput(e.target.value)} />
      </label>
      <p className="wowd-dialog-note">
        (1)〜(9)、(a)〜(z)、(ｱ)〜(ﾝ) を全角 1 文字分の幅に収めます。
      </p>
      <Check label="カッコ文字の後にスペースを挿入しない" checked={noSpace} onChange={setNoSpace} />
      <Check
        label="カッコ内が半角 2 文字以上又は全角の場合でも、全角 1 文字分に収める"
        checked={fit}
        onChange={setFit}
      />
      <div className="wowd-dialog-preview" data-testid="okaguchi-preview">
        {runs.map((r, i) => (
          <span
            key={i}
            style={
              r.w !== 100
                ? { display: 'inline-block', transform: `scaleX(${r.w / 100})`, transformOrigin: 'left', marginRight: `${-(1 - r.w / 100) * (r.text.length * 0.5)}em` }
                : undefined
            }
          >
            {r.text}
          </span>
        ))}
        {runs.length === 0 && ' '}
      </div>
    </Dialog>
  )
}
