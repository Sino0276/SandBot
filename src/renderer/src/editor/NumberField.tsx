import { useRef, useState } from 'react'
import { formatNumber } from '../units/units'
import { numberCommit } from './numberFieldModel'
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
  // 읽을 수 없으면 null을 돌려준다(invalidTitle이 없으면 그 입력은 버린다).
  parse?: (text: string) => number | null
  title?: string
  // 있으면 읽지 못한 입력을 버리지 않고 남겨 틀렸다고 보인다(OptionalField와 같은 방식, 그때 칸의 title).
  // 다시 고치거나 Esc를 누르거나 값이 바뀌면(실행 취소 등) 사라진다. 남긴 글자는 초안이 아니라 창 닫기 확인을 켜지 않는다.
  invalidTitle?: string
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
  invalidTitle,
  onCommit
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useDraft()
  const [rejected, setRejected] = useState<{ text: string; value: number } | null>(null)
  const cancelled = useRef(false)
  // 받지 않은 글자는 그때의 값 그대로일 때만 보인다
  const shownRejected =
    invalidTitle !== undefined && rejected !== null && Object.is(rejected.value, value)
      ? rejected.text
      : null
  const invalid = draft === null && shownRejected !== null

  const commit = (): void => {
    if (cancelled.current) {
      setRejected(null)
    } else if (draft !== null) {
      const result = numberCommit(draft, parse)
      if (result.kind === 'set') {
        setRejected(null)
        onCommit(result.value)
      } else setRejected({ text: draft, value })
    }
    cancelled.current = false
    setDraft(null)
  }

  const className = axis ? `number-field axis-${axis}` : 'number-field'
  return (
    <label className={invalid ? `${className} is-invalid` : className}>
      {label && <span className="number-field-label">{label}</span>}
      <input
        type="text"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={invalid ? invalidTitle : title}
        value={draft ?? shownRejected ?? formatNumber(value, digits)}
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
