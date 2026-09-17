import type { ReactNode } from 'react'

export function RibbonGroup({
  label,
  children
}: {
  label: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  )
}

export function RibbonRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="ribbon-row">{children}</div>
}

export function RibbonButton({
  label,
  title,
  active = false,
  disabled = false,
  wide = false,
  onClick
}: {
  label: ReactNode
  title: string
  active?: boolean
  disabled?: boolean
  wide?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`ribbon-button${active ? ' is-active' : ''}${wide ? ' is-wide' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // エディタからフォーカスを奪うと選択範囲が消えるので押下時に既定動作を止める
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function RibbonSelect<T extends string | number>({
  value,
  options,
  title,
  width,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  title: string
  width?: number
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <select
      className="ribbon-select"
      title={title}
      aria-label={title}
      value={String(value)}
      style={width ? { width } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const raw = e.target.value
        const found = options.find((o) => String(o.value) === raw)
        if (found) onChange(found.value)
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
