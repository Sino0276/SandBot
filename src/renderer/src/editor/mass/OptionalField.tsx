import { useRef } from 'react'
import { useDraft } from '../useDraft'

type OptionalFieldProps = {
  ariaLabel: string
  // 지금 값의 글자(정하지 않았으면 '')
  value: string
  // 비었을 때 흐리게 보이는 것(추정값·물려받은 값)
  placeholder?: string
  title?: string
  // 입력 글자를 값으로 읽는다. 읽지 못하거나 범위 밖이면 null(그 입력은 버리고 이전 값을 둔다)
  parse: (text: string) => number | null
  // 지우고 확정하면 null(정한 값을 떼어 추정·상속으로 돌아간다)
  onCommit: (value: number | null) => void
}

// 비울 수 있는 숫자 입력칸(질량 덮어쓰기·저울 무게·채움률). NumberField처럼 Enter·포커스 이동에 확정하고 Esc는 취소하며,
// 확정하지 않은 글자는 useDraft로 창 닫기 확인을 거친다. 빈 글자로 확정하면 값을 뗀다.
function OptionalField({
  ariaLabel,
  value,
  placeholder,
  title,
  parse,
  onCommit
}: OptionalFieldProps): React.JSX.Element {
  const [draft, setDraft] = useDraft()
  const cancelled = useRef(false)

  const commit = (): void => {
    if (draft !== null && !cancelled.current) {
      const text = draft.trim()
      if (text === '') {
        if (value !== '') onCommit(null)
      } else if (text !== value) {
        const parsed = parse(text)
        if (parsed !== null && Number.isFinite(parsed)) onCommit(parsed)
      }
    }
    cancelled.current = false
    setDraft(null)
  }

  return (
    <label className="number-field">
      <input
        type="text"
        aria-label={ariaLabel}
        title={title}
        value={draft ?? value}
        placeholder={placeholder}
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

export default OptionalField
