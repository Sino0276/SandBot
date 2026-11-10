import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogStore } from './dialogStore'

// 창 안에서 Tab으로 도는 요소
const FOCUSABLE =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Props<C extends string> = {
  title: string
  categories: { id: C; label: string }[]
  category: C
  onCategory: (category: C) => void
  onClose: () => void
  // 지금도 열려 있는지(StrictMode의 정리→재실행에서는 포커스를 돌려주지 않는다)
  isOpen: () => boolean
  // 열 때 포커스를 둘 요소(없으면 고른 분류)
  initialFocus?: (dialog: HTMLElement) => HTMLElement | null
  children: React.ReactNode
}

// 분류 목록 + 본문 꼴의 설정 창 틀(Unity Preferences·Project Settings). 환경 설정(개인)과 프로젝트 설정(팀)이 같이 쓴다.
// 포커스: 열 때 창 안으로 옮기고, Tab은 창 안에서만 돌고, Esc로 닫으며, 닫으면 연 곳으로 돌려준다(DialogHost와 같음).
function SettingsDialog<C extends string>({
  title,
  categories,
  category,
  onCategory,
  onClose,
  isOpen,
  initialFocus,
  children
}: Props<C>): React.JSX.Element {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  // 연 곳(툴바 버튼). StrictMode가 effect를 다시 실행하면 그때는 포커스가 이미 창 안이므로 처음 값을 ref에 지킨다.
  const previousFocus = useRef<HTMLElement | null>(null)
  // effect는 한 번만 붙인다(처음 props로 충분하다: 닫기·열림 확인·첫 포커스)
  const handlers = useRef({ onClose, isOpen, initialFocus })

  useEffect(() => {
    const { onClose: close, isOpen: open, initialFocus: first } = handlers.current
    const active = document.activeElement
    if (active instanceof HTMLElement && !dialogRef.current?.contains(active))
      previousFocus.current = active
    const focusable = (): HTMLElement[] =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const dialog = dialogRef.current
    const section = dialog && first ? first(dialog) : null
    if (section) section.focus({ preventScroll: true })
    else
      (
        dialog?.querySelector<HTMLElement>('.preferences-category.is-active') ?? focusable()[0]
      )?.focus()
    // 확인 대화상자(창 닫기 확인 등)가 위에 뜨면 키보드·포커스는 그 대화상자 몫이다
    const dialogOnTop = (): boolean => useDialogStore.getState().request !== null
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dialogOnTop()) return
      if (event.key === 'Escape') {
        // 입력칸의 Esc는 그 칸의 편집 취소다(TextField가 초안을 버리고 포커스를 놓는다). 한 번 더 누르면 닫는다.
        if (
          event.target instanceof HTMLInputElement &&
          event.target.type === 'text' &&
          dialogRef.current?.contains(event.target)
        )
          return
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey
        ? index <= 0
          ? items.length - 1
          : index - 1
        : index < 0 || index === items.length - 1
          ? 0
          : index + 1
      event.preventDefault()
      items[next].focus()
    }
    // 포커스가 창 밖으로 나가면(클릭 등) 다시 안으로 가져온다
    const onFocusIn = (event: FocusEvent): void => {
      if (dialogOnTop()) return
      if (event.target instanceof Node && dialogRef.current?.contains(event.target)) return
      focusable()[0]?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      // StrictMode의 정리→재실행에서는 아직 열려 있으므로 포커스를 돌려주지 않는다
      if (open()) return
      const previous = previousFocus.current
      previousFocus.current = null
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        // 바깥(어두운 배경)을 누르면 닫는다. 입력 중인 칸은 먼저 확정한다(닫기 버튼을 누를 때 포커스가 옮겨 확정되는 것과 같게).
        if (event.target !== event.currentTarget) return
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="dialog preferences"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="preferences-header">
          <span className="preferences-title">{title}</span>
          <button
            type="button"
            className="hw-card-remove"
            title={t('preferences.close')}
            aria-label={t('preferences.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="preferences-body">
          <nav className="preferences-categories" aria-label={t('preferences.categories')}>
            {categories.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={
                  id === category ? 'preferences-category is-active' : 'preferences-category'
                }
                aria-current={id === category || undefined}
                onClick={() => onCategory(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {children}
        </div>
        <div className="dialog-buttons">
          <button type="button" className="dialog-button" onClick={onClose}>
            {t('preferences.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog
