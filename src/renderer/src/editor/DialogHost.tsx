import { useEffect, useRef } from 'react'
import { useDialogStore } from './dialogStore'

function DialogHost(): React.JSX.Element | null {
  const request = useDialogStore((state) => state.request)
  const answer = useDialogStore((state) => state.answer)
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  // 대화상자를 열기 전 포커스(하이어라키 행 등). 닫으면 돌려준다.
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!request) return
    // 개발 모드 StrictMode의 재실행이나 다음 대화상자에서는 이미 대화상자 안에 포커스가 있으므로 덮어쓰지 않는다
    const active = document.activeElement
    if (active instanceof HTMLElement && !dialogRef.current?.contains(active))
      previousFocus.current = active
    primaryRef.current?.focus()
    const buttons = (): HTMLElement[] =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        answer(request.cancelId)
        return
      }
      // 포커스 가두기: Tab·Shift+Tab은 대화상자 버튼 사이만 돈다
      if (event.key !== 'Tab') return
      const focusable = buttons()
      if (focusable.length === 0) return
      const index = focusable.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey
        ? index <= 0
          ? focusable.length - 1
          : index - 1
        : index < 0 || index === focusable.length - 1
          ? 0
          : index + 1
      event.preventDefault()
      focusable[next].focus()
    }
    // 포커스가 대화상자 밖으로 나가면(클릭 등) 다시 안으로 가져온다
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof Node && dialogRef.current?.contains(event.target)) return
      ;(primaryRef.current ?? buttons()[0])?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      const previous = previousFocus.current
      if (useDialogStore.getState().request) return
      previousFocus.current = null
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [request, answer])

  if (!request) return null
  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.message}
      >
        <p className="dialog-message">{request.message}</p>
        <div className="dialog-buttons">
          {request.buttons.map((button) => (
            <button
              key={button.id}
              ref={button.primary ? primaryRef : undefined}
              type="button"
              className={button.primary ? 'dialog-button is-primary' : 'dialog-button'}
              onClick={() => answer(button.id)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DialogHost
