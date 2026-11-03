import { useRef, useState } from 'react'
import { useDraft } from '../useDraft'
import { optionalCommit } from './massCardModel'

type OptionalFieldProps = {
  ariaLabel: string
  // 지금 값의 글자(정하지 않았으면 '')
  value: string
  // 비었을 때 흐리게 보이는 것(추정값·물려받은 값)
  placeholder?: string
  title?: string
  // 받지 않은 입력을 틀렸다고 보일 때의 설명(입력칸의 title)
  invalidTitle: string
  // 입력 글자를 값으로 읽는다. 읽지 못하거나 범위 밖이면 null(이전 값을 두고 입력칸이 틀렸다고 보인다)
  parse: (text: string) => number | null
  // 지우고 확정하면 null(정한 값을 떼어 추정·상속으로 돌아간다)
  onCommit: (value: number | null) => void
}

// 비울 수 있는 숫자 입력칸(질량 덮어쓰기·저울 무게·채움률). NumberField처럼 Enter·포커스 이동에 확정하고 Esc는 취소하며,
// 확정하지 않은 글자는 useDraft로 창 닫기 확인을 거친다. 빈 글자로 확정하면 값을 뗀다. 받지 않은 입력(읽지 못함·범위
// 밖)은 값을 바꾸지 않고, 그 글자를 남겨 테두리·aria-invalid로 틀렸다고 보인다(조용히 버리지 않는다). 다시 고치거나
// Esc를 누르거나 값이 바뀌면(실행 취소 등) 사라진다. 남긴 글자는 초안이 아니라 창 닫기 확인을 켜지 않는다.
function OptionalField({
  ariaLabel,
  value,
  placeholder,
  title,
  invalidTitle,
  parse,
  onCommit
}: OptionalFieldProps): React.JSX.Element {
  const [draft, setDraft] = useDraft()
  const [rejected, setRejected] = useState<{ text: string; value: string } | null>(null)
  const cancelled = useRef(false)
  // 받지 않은 글자는 그때의 값 그대로일 때만 보인다
  const shownRejected = rejected !== null && rejected.value === value ? rejected.text : null
  const invalid = draft === null && shownRejected !== null

  const commit = (): void => {
    if (cancelled.current) {
      setRejected(null)
    } else if (draft !== null) {
      const result = optionalCommit(draft, value, parse)
      if (result.kind === 'rejected') {
        setRejected({ text: draft, value })
      } else {
        setRejected(null)
        if (result.kind === 'clear') onCommit(null)
        if (result.kind === 'set') onCommit(result.value)
      }
    }
    cancelled.current = false
    setDraft(null)
  }

  return (
    <label className={invalid ? 'number-field is-invalid' : 'number-field'}>
      <input
        type="text"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={invalid ? invalidTitle : title}
        value={draft ?? shownRejected ?? value}
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
