import { useRef } from 'react'
import { useDraft } from './useDraft'

type NumberFieldProps = {
  // 입력칸 앞에 붙는 짧은 글자(X·Y·Z). 없으면 ariaLabel로 이름만 붙인다.
  label?: string
  ariaLabel?: string
  axis?: 'x' | 'y' | 'z'
  value: number
  digits: number
  disabled?: boolean
  onCommit: (value: number) => void
}

function format(value: number, digits: number): string {
  // -0.000 대신 0.000으로 보이게 한다
  const rounded = Number(value.toFixed(digits))
  return (rounded === 0 ? 0 : rounded).toFixed(digits)
}

// 입력 중에는 초안을 보여 주고, Enter나 포커스 이동으로 확정한다. Esc는 취소.
function NumberField({
  label,
  ariaLabel,
  axis,
  value,
  digits,
  disabled = false,
  onCommit
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useDraft()
  const cancelled = useRef(false)

  const commit = (): void => {
    if (draft !== null && !cancelled.current) {
      const parsed = Number(draft.trim())
      if (draft.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed)
    }
    cancelled.current = false
    setDraft(null)
  }

  return (
    <label className={axis ? `number-field axis-${axis}` : 'number-field'}>
      {label && <span className="number-field-label">{label}</span>}
      <input
        type="text"
        aria-label={ariaLabel}
        inputMode="decimal"
        value={draft ?? format(value, digits)}
        disabled={disabled}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelled.current = true
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

export default NumberField
