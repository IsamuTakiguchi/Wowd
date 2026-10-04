import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import { parseDateInput, formatDateEntry, type DateStyle } from '@core/okaguchi/dates'
import { insertPlain } from '../insert'
import { Choice, Preview, today } from './common'

/**
 * 日付入力 (Alt+T)。日付 (空なら今日) を、西暦・和暦などの表記で差し込む。
 *
 * 入力の例: r2/5/3、2004/12/5、9/15 (今年)、空 (今日)。
 */
export function DateDialog({ editor, onClose }: { editor: Editor | null; onClose: () => void }): React.JSX.Element {
  const [input, setInput] = useState('')
  const [style, setStyle] = useState<DateStyle>('western')
  const [wide, setWide] = useState<'wide' | 'narrow'>('wide')
  const [weekday, setWeekday] = useState<'no' | 'yes'>('no')
  const [holiday, setHoliday] = useState<'no' | 'yes'>('no')

  const [now] = useState(today)
  const parsed = useMemo(() => parseDateInput(input, now), [input, now])
  const output = parsed
    ? formatDateEntry(parsed, {
        style,
        wide: wide === 'wide',
        weekday: weekday === 'yes',
        holiday: holiday === 'yes'
      })
    : ''

  // 表記の選択肢には今日の日付で見本を出す (元のフォームと同じ)
  const sample = (s: DateStyle): string =>
    formatDateEntry(
      { ...now, monthText: String(now.m), dayText: String(now.d) },
      { style: s, wide: false, weekday: false, holiday: false }
    )

  const submit = (): void => {
    if (!editor || !parsed) return
    insertPlain(editor, output)
    onClose()
  }

  return (
    <Dialog title="日付入力" open onClose={onClose} onSubmit={submit} submitDisabled={!parsed} width={460}>
      <label className="wowd-dialog-field">
        <span>特定の日付 (年/月/日。例: s60/5/24、2004/12/5。今年なら 9/15、今日なら空欄)</span>
        <input
          autoFocus
          value={input}
          data-testid="okaguchi-date-input"
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      <Choice
        legend="表記"
        name="okaguchi-date-style"
        value={style}
        onChange={setStyle}
        options={(['western', 'wareki', 'westernWareki', 'warekiWestern'] as DateStyle[]).map((s) => ({
          value: s,
          label: sample(s)
        }))}
      />
      <div className="wowd-dialog-row">
        <Choice
          legend="入力方法"
          name="okaguchi-date-width"
          value={wide}
          onChange={setWide}
          options={[
            { value: 'wide', label: '全角' },
            { value: 'narrow', label: '半角' }
          ]}
        />
        <Choice
          legend="曜日"
          name="okaguchi-date-weekday"
          value={weekday}
          onChange={setWeekday}
          options={[
            { value: 'no', label: '無' },
            { value: 'yes', label: '有' }
          ]}
        />
        <Choice
          legend="休日"
          name="okaguchi-date-holiday"
          value={holiday}
          onChange={setHoliday}
          options={[
            { value: 'no', label: '無' },
            { value: 'yes', label: '有' }
          ]}
        />
      </div>
      <Preview text={output} error={parsed ? null : '日付の形式が正しくありません。'} />
    </Dialog>
  )
}
