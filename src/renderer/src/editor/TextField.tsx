import { useRef, useState } from 'react'

type TextFieldProps = {
  value: string
  label: string
  placeholder?: string
  // 값이 형식에 맞지 않을 때 테두리로 표시한다(확정은 막지 않는다)
  invalid?: boolean
  onCommit: (value: string) => void
}

// 입력 중에는 초안을 보여 주고, Enter나 포커스 이동으로 확정한다. Esc는 취소.
// 글자마다 씬을 바꾸면 변경 표시·검증·코드 미리보기가 매번 다시 돌기 때문이다.
function TextField({
  value,
  label,
  placeholder,
  invalid = false,
  onCommit
}: TextFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  const commit = (): void => {
    if (draft !== null && !cancelled.current && draft !== value) onCommit(draft)
    cancelled.current = false
    setDraft(null)
  }

  return (
    <input
      type="text"
      className={invalid ? 'text-field is-invalid' : 'text-field'}
      aria-label={label}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      placeholder={placeholder}
      value={draft ?? value}
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
  )
}

export default TextField
