import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ExternalEditorChoice,
  ExternalEditorError,
  ExternalEditorState
} from '../../../shared/ipc'
import { ipcErrorDetail, resetLineSupport } from '../java/openScript'
import JdkSection from '../play/ui/JdkSection'
import SimulationPreferences from '../play/ui/SimulationPreferences'
import { closePreferences, useDialogStore, usePreferencesStore } from './dialogStore'
import {
  EXTERNAL_EDITOR_BROWSE,
  EXTERNAL_EDITOR_ERROR_NOTICES,
  externalEditorChoice,
  externalEditorOptions,
  externalEditorValue
} from './externalEditorOptions'
import { dismissNotice, showNotice } from './noticeStore'
import TextField from './TextField'

// 닫힌 선택 상자에서 값을 바로 바꾸는 키(Windows)
const SELECT_MOVE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

// 창 안에서 Tab으로 도는 요소
const FOCUSABLE =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 외부 편집기 설정의 마지막 알림. 다음에 고르면 지운다(고친 뒤에도 이전 오류가 남지 않게).
let lastNotice = 0

function replacePreferencesNotice(...args: Parameters<typeof showNotice>): void {
  dismissNotice(lastNotice)
  lastNotice = showNotice(...args)
}

// Unity Preferences > External Tools > External Script Editor. 설정은 실행 파일 경로를 담으므로 메인 프로세스가
// 갖고(userData), 여기서는 고르기만 한다. 찾아보기 대화상자도 메인이 띄운다.
function ExternalToolsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = useState<ExternalEditorState | null>(null)
  // 설정을 읽지 못했다(창 안에 알린다. 알림 목록은 창 뒤에 가려진다)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pending, setPending] = useState(false)
  // 마지막 선택을 메인이 받지 않은 이유. 창 안에도 보인다(알림 목록은 창 뒤에 가려진다).
  const [error, setError] = useState<ExternalEditorError | null>(null)
  // 바꾸는 중에 온 선택은 무시한다(선택 상자를 끄면 포커스를 잃으므로 끄지 않는다)
  const pendingRef = useRef(false)
  // 창을 닫은 뒤 늦게 온 응답은 버린다
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    window.api
      .getExternalEditor()
      .then((next) => {
        if (mounted.current) setState(next)
      })
      .catch((error: unknown) => {
        replacePreferencesNotice('error', 'externalEditorFailed', { detail: ipcErrorDetail(error) })
        if (mounted.current) setLoadFailed(true)
      })
    return () => {
      mounted.current = false
    }
  }, [])

  const apply = async (choice: ExternalEditorChoice): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    dismissNotice(lastNotice)
    lastNotice = 0
    try {
      const next = await window.api.setExternalEditor(choice)
      // 받지 않았으면 설정은 그대로이고 이유가 붙어 온다
      if (next.error) replacePreferencesNotice('warning', EXTERNAL_EDITOR_ERROR_NOTICES[next.error])
      // 편집기나 인자가 바뀌었으면 줄 번호를 받는지 다시 모른다(다음에 줄로 열 때 정한다)
      else resetLineSupport()
      if (mounted.current) {
        setState(next)
        setError(next.error ?? null)
      }
    } catch (error) {
      replacePreferencesNotice('error', 'externalEditorFailed', { detail: ipcErrorDetail(error) })
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
    }
  }

  // Windows의 닫힌 select는 화살표·글자 키마다 change를 낸다. 키로 [찾아보기…]에 닿았을 때 파일 대화상자가 열리지 않게
  // 마우스나 펼친 목록(Alt+↓·F4)에서 고른 것만 찾아보기로 친다.
  const keyChange = useRef(false)
  const onSelect = (value: string): void => {
    const byKey = keyChange.current
    keyChange.current = false
    if (value === EXTERNAL_EDITOR_BROWSE && byKey) return
    const choice = externalEditorChoice(value, t('preferences.externalTools.browseTitle'))
    if (choice) void apply(choice)
  }

  return (
    <section className="preferences-page" aria-labelledby="preferences-external-tools">
      <h2 id="preferences-external-tools" className="preferences-page-title">
        {t('preferences.externalTools.title')}
      </h2>
      {!state ? (
        <p className={loadFailed ? 'preferences-error' : 'inspector-note'}>
          {loadFailed
            ? t('preferences.externalTools.loadFailed')
            : t('preferences.externalTools.loading')}
        </p>
      ) : (
        <>
          <label className="preferences-row">
            <span className="preferences-row-label">
              {t('preferences.externalTools.scriptEditor')}
            </span>
            <select
              className="field-select"
              value={externalEditorValue(state)}
              aria-busy={pending || undefined}
              onKeyDown={(event) => {
                keyChange.current = event.key.length === 1 || SELECT_MOVE_KEYS.has(event.key)
              }}
              onChange={(event) => onSelect(event.target.value)}
            >
              {/* 편집기 제품 이름과 실행 파일 이름은 번역하지 않는다 */}
              {externalEditorOptions(state).map((option) => (
                <option key={option.value} value={option.value}>
                  {'labelKey' in option
                    ? t(`preferences.externalTools.${option.labelKey}`)
                    : option.text}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="preferences-error" role="alert">
              {t(`notice.${EXTERNAL_EDITOR_ERROR_NOTICES[error]}`)}
            </p>
          )}
          {state.kind === 'system' && (
            <p className="inspector-note">{t('preferences.externalTools.systemHint')}</p>
          )}
          {state.kind === 'system' && state.detected.length === 0 && (
            <p className="inspector-note">{t('preferences.externalTools.noneDetected')}</p>
          )}
          {state.kind !== 'system' && state.exe && (
            <div className="preferences-row">
              <span className="preferences-row-label">{t('preferences.externalTools.exe')}</span>
              <code className="hw-path preferences-exe" title={state.exe}>
                {state.exe}
              </code>
            </div>
          )}
          {state.kind === 'detected' && (
            <p className="inspector-note">{t('preferences.externalTools.detectedHint')}</p>
          )}
          {state.kind === 'custom' && (
            <>
              <div className="preferences-row">
                <span className="preferences-row-label">{t('preferences.externalTools.args')}</span>
                <div className="preferences-args">
                  <TextField
                    label={t('preferences.externalTools.args')}
                    value={state.args ?? ''}
                    placeholder={state.defaultArgs}
                    onCommit={(args) => void apply({ kind: 'customArgs', args })}
                  />
                  <button
                    type="button"
                    className="panel-button"
                    disabled={pending || (state.args ?? '') === state.defaultArgs}
                    title={t('preferences.externalTools.resetHint', { args: state.defaultArgs })}
                    onClick={() => void apply({ kind: 'resetArgs' })}
                  >
                    {t('preferences.externalTools.reset')}
                  </button>
                </div>
              </div>
              <p className="inspector-note">{t('preferences.externalTools.argsHint')}</p>
            </>
          )}
        </>
      )}
      {/* Unity External Tools의 JDK 칸처럼 실행(사이드카)에 쓸 JDK */}
      <JdkSection />
    </section>
  )
}

const CATEGORIES = ['externalTools', 'simulation'] as const
type Category = (typeof CATEGORIES)[number]

function PreferencesDialog(): React.JSX.Element {
  const { t } = useTranslation()
  // 연 곳이 정한 분류(실행할 JDK가 없다는 알림은 외부 도구의 JDK 칸을 연다)
  const [category, setCategory] = useState<Category>(() =>
    usePreferencesStore.getState().target === 'simulation' ? 'simulation' : 'externalTools'
  )
  const dialogRef = useRef<HTMLDivElement>(null)
  // 연 곳(툴바 버튼). StrictMode가 effect를 다시 실행하면 그때는 포커스가 이미 창 안이므로 처음 값을 ref에 지킨다.
  const previousFocus = useRef<HTMLElement | null>(null)

  // 포커스: 열 때 창 안으로 옮기고, Tab은 창 안에서만 돌고, Esc로 닫으며, 닫으면 연 곳으로 돌려준다(DialogHost와 같음)
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && !dialogRef.current?.contains(active))
      previousFocus.current = active
    const focusable = (): HTMLElement[] =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    // 처음에는 고른 분류에 둔다. JDK 칸을 열라고 했으면 그 칸으로 옮긴다.
    const section =
      usePreferencesStore.getState().target === 'jdk'
        ? dialogRef.current?.querySelector<HTMLElement>('[data-preferences-section="jdk"]')
        : null
    if (section) {
      section.scrollIntoView({ block: 'nearest' })
      section.focus({ preventScroll: true })
    } else
      (
        dialogRef.current?.querySelector<HTMLElement>('.preferences-category.is-active') ??
        focusable()[0]
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
        closePreferences()
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
      if (usePreferencesStore.getState().open) return
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
        closePreferences()
      }}
    >
      <div
        ref={dialogRef}
        className="dialog preferences"
        role="dialog"
        aria-modal="true"
        aria-label={t('preferences.title')}
      >
        <header className="preferences-header">
          <span className="preferences-title">{t('preferences.title')}</span>
          <button
            type="button"
            className="hw-card-remove"
            title={t('preferences.close')}
            aria-label={t('preferences.close')}
            onClick={closePreferences}
          >
            ×
          </button>
        </header>
        <div className="preferences-body">
          <nav className="preferences-categories" aria-label={t('preferences.categories')}>
            {CATEGORIES.map((id) => (
              <button
                key={id}
                type="button"
                className={
                  id === category ? 'preferences-category is-active' : 'preferences-category'
                }
                aria-current={id === category || undefined}
                onClick={() => setCategory(id)}
              >
                {t(`preferences.${id}.title`)}
              </button>
            ))}
          </nav>
          {category === 'externalTools' && <ExternalToolsPage />}
          {category === 'simulation' && <SimulationPreferences />}
        </div>
        <div className="dialog-buttons">
          <button type="button" className="dialog-button" onClick={closePreferences}>
            {t('preferences.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// 환경 설정 창(Unity의 Edit > Preferences). 툴바 버튼으로 열고, 열려 있는 동안 창 단축키는 쓰지 않는다(isModalOpen).
function PreferencesWindow(): React.JSX.Element | null {
  const open = usePreferencesStore((state) => state.open)
  return open ? <PreferencesDialog /> : null
}

export default PreferencesWindow
