import type { ReactNode } from 'react'

/** 今日の日付 (年月日だけ) */
export function today(): { y: number; m: number; d: number } {
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
}

/** 選択肢をラジオボタンで並べる */
export function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange
}: {
  legend: string
  name: string
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <fieldset className="wowd-dialog-fieldset">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="wowd-dialog-radio">
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            data-testid={`${name}-${o.value}`}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

export function Check({
  label,
  checked,
  onChange,
  testId
}: {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  testId?: string
}): React.JSX.Element {
  return (
    <label className="wowd-dialog-radio">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

/** 入力画面の下に出す、出力の見本 */
export function Preview({ text, error }: { text: string; error?: string | null }): React.JSX.Element {
  return (
    <div className="wowd-dialog-preview" data-testid="okaguchi-preview" aria-live="polite">
      {error ? <span className="wowd-dialog-error">{error}</span> : text || ' '}
    </div>
  )
}
