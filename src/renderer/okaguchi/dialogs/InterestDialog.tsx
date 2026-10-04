import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import { parseDateInput } from '@core/okaguchi/dates'
import {
  calculateInterest,
  interestReport,
  parsePrincipal,
  defaultLegalRate
} from '@core/okaguchi/interest'
import { insertParagraphs } from '../insert'
import { Check, Choice, today } from './common'

/**
 * 利息・日付計算 (Alt+C)。
 *
 * 結果は入力に合わせてその場で見本に出る (元のフォームの「ポップアップで確認」に当たる)。
 * OK で文書に差し込む。
 */
export function InterestDialog({ editor, onClose }: { editor: Editor | null; onClose: () => void }): React.JSX.Element {
  const [startText, setStartText] = useState('')
  const [endText, setEndText] = useState('')
  const [principalText, setPrincipalText] = useState('')
  const [rateText, setRateText] = useState('')
  const [roundHalfUp, setRoundHalfUp] = useState(false)
  const [fixed365, setFixed365] = useState(false)
  const [fraction365, setFraction365] = useState(false)
  const [excludeFirstDay, setExcludeFirstDay] = useState(false)
  const [width, setWidth] = useState<'wide' | 'narrow'>('wide')
  const [now] = useState(today)

  const outcome = useMemo((): { error: string; lines?: undefined } | { lines: string[]; error?: undefined } => {
    const start = parseDateInput(startText, now)
    const end = parseDateInput(endText, now)
    if (!start) return { error: '開始日の形式が正しくありません。' }
    if (!end) return { error: '終了日の形式が正しくありません。' }
    const principal = parsePrincipal(principalText)
    if (principal == null) return { error: principalText.trim() ? '元金は数字で入力してください。' : '元金を入力してください。' }
    const legal = rateText.trim() === '' ? defaultLegalRate(start) : null
    const input = {
      start,
      end,
      principal,
      rate: legal?.rate ?? rateText,
      roundHalfUp,
      fixed365,
      fraction365,
      excludeFirstDay
    }
    const result = calculateInterest(input)
    if ('error' in result) return { error: result.error }
    return { lines: interestReport(input, result, { wide: width === 'wide', defaultRateNote: legal?.note ?? null }) }
  }, [startText, endText, principalText, rateText, roundHalfUp, fixed365, fraction365, excludeFirstDay, width, now])

  const submit = (): void => {
    if (!editor || !outcome.lines) return
    insertParagraphs(editor, outcome.lines)
    onClose()
  }

  return (
    <Dialog title="利息・日付計算" open onClose={onClose} onSubmit={submit} submitDisabled={!outcome.lines} submitLabel="文書に入力" width={560}>
      <div className="wowd-dialog-grid">
        <label htmlFor="okaguchi-interest-start">開始日</label>
        <input id="okaguchi-interest-start" autoFocus value={startText} placeholder="空欄なら今日" data-testid="okaguchi-interest-start" onChange={(e) => setStartText(e.target.value)} />
        <label htmlFor="okaguchi-interest-end">終了日</label>
        <input id="okaguchi-interest-end" value={endText} placeholder="空欄なら今日" data-testid="okaguchi-interest-end" onChange={(e) => setEndText(e.target.value)} />
        <label htmlFor="okaguchi-interest-principal">元金 (円)</label>
        <input id="okaguchi-interest-principal" value={principalText} inputMode="numeric" data-testid="okaguchi-interest-principal" onChange={(e) => setPrincipalText(e.target.value)} />
        <label htmlFor="okaguchi-interest-rate">利率 (年 %)</label>
        <input id="okaguchi-interest-rate" value={rateText} placeholder="空欄なら法定利率 (2020/4/1 以降 3%、それより前 5%)" data-testid="okaguchi-interest-rate" onChange={(e) => setRateText(e.target.value)} />
      </div>
      <p className="wowd-dialog-note">
        日付は 年/月/日 (例: r2/4/1、2020/4/1)。今年なら 月/日、今日なら空欄。
      </p>
      <Check label="四捨五入にする (チェックしない場合は切り捨て)" checked={roundHalfUp} onChange={setRoundHalfUp} />
      <Check label="1 年間を 365 日で計算 (閏年を 366 日 = 1 年と 1 日で計算)" checked={fixed365} onChange={setFixed365} />
      <Check label="1 年未満の期間を 365 日で計算" checked={fraction365} onChange={setFraction365} />
      <Check label="初日を算入しない (チェックしない場合は初日算入)" checked={excludeFirstDay} onChange={setExcludeFirstDay} />
      <Choice
        legend="入力方法"
        name="okaguchi-interest-width"
        value={width}
        onChange={setWidth}
        options={[
          { value: 'wide', label: '全角で入力' },
          { value: 'narrow', label: '半角で入力' }
        ]}
      />
      <div className="wowd-dialog-preview okaguchi-result" data-testid="okaguchi-preview">
        {outcome.error ? (
          <span className="wowd-dialog-error">{outcome.error}</span>
        ) : (
          (outcome.lines ?? []).map((l, i) => <div key={i}>{l || '\u00a0'}</div>)
        )}
      </div>
    </Dialog>
  )
}
