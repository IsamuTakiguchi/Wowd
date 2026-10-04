import { useState } from 'react'
import { Dialog, Field } from '../../components/dialogs/Dialog'
import { useUiStore } from '../../store/ui'
import { LATIN_FONTS, type LatinFont } from '@core/okaguchi/pageFormat'
import { applyCourtFormat } from '../format'

/**
 * 書式変更 (Alt+P)。文書を裁判所書式 (A4・37 字 × 26 行・12pt) にする。
 *
 * 元のマクロのフォームと同じく、英数字のフォントと行番号の有無だけを選ぶ。
 */
export function FormatDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [latin, setLatin] = useState<LatinFont>('Times New Roman')
  const [lineNumbers, setLineNumbers] = useState(false)

  const apply = (): void => {
    if (!applyCourtFormat(latin, lineNumbers)) return
    useUiStore.getState().notify('書式変更が完了しました (A4・37 字 × 26 行・12pt)')
    onClose()
  }

  return (
    <Dialog title="裁判所書式へ変更します" open onClose={onClose} onSubmit={apply} width={440}>
      <p className="wowd-dialog-note">
        A4 縦、余白 上 35・下 25・左 30・右 20 mm、1 行 37 字 × 26 行、12pt、
        フッターにページ番号 (中央) を入れます。フッターの中身は置き換わります。
      </p>
      <fieldset className="wowd-dialog-fieldset">
        <legend>半角英数字のフォント</legend>
        {LATIN_FONTS.map((font) => (
          <label key={font} className="wowd-dialog-radio">
            <input
              type="radio"
              name="okaguchi-latin"
              checked={latin === font}
              onChange={() => setLatin(font)}
            />
            {font}
          </label>
        ))}
      </fieldset>
      <Field label="行番号">
        <label className="wowd-dialog-radio">
          <input
            type="checkbox"
            checked={lineNumbers}
            data-testid="okaguchi-line-numbers"
            onChange={(e) => setLineNumbers(e.target.checked)}
          />
          行番号を挿入する (5 行ごと・ページごとに振り直し。Word で表示されます)
        </label>
      </Field>
    </Dialog>
  )
}
