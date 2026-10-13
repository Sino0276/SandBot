import { useEffect, useRef } from 'react'
import { useDialogStore } from './dialogStore'

function DialogHost(): React.JSX.Element | null {
  const request = useDialogStore((state) => state.request)
  const answer = useDialogStore((state) => state.answer)
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!request) return
    primaryRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') answer(request.cancelId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [request, answer])

  if (!request) return null
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={request.message}>
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
