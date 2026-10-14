import { useRef } from 'react'
import { formatNumber } from '../units/units'
import { useDraft } from './useDraft'

type NumberFieldProps = {
  // 입력칸 앞에 붙는 짧은 글자(X·Y·Z). 없으면 ariaLabel로 이름만 붙인다.
  label?: string
  ariaLabel?: string
  axis?: 'x' | 'y' | 'z'
  value: number
  digits: number
  disabled?: boolean
  // 입력 문자열을 이 칸의 단위 값으로 읽는다(예: "12in" → 표시 단위 값). 없으면 숫자만 받는다.
  // 읽을 수 없으면 null을 돌려주고, 그 입력은 버린다.
  parse?: (text: string) => number | null
  title?: string
  onCommit: (value: number) => void
}

function parseNumber(text: string): number | null {
  const value = Number(text.trim())
  return text.trim() !== '' && Number.isFinite(value) ? value : null
}

// 입력 중에는 초안을 보여 주고, Enter나 포커스 이동으로 확정한다. Esc는 취소.
function NumberField({
  label,
  ariaLabel,
  axis,
  value,
  digits,
  disabled = false,
  parse = parseNumber,
  title,
  onCommit
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useDraft()
  const cancelled = useRef(false)

  const commit = (): void => {
    if (draft !== null && !cancelled.current) {
      const parsed = parse(draft)
      if (parsed !== null && Number.isFinite(parsed)) onCommit(parsed)
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
        title={title}
        value={draft ?? formatNumber(value, digits)}
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
