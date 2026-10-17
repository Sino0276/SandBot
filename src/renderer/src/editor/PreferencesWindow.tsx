import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ExternalEditorChoice,
  ExternalEditorError,
  ExternalEditorState
} from '../../../shared/ipc'
import { fileNameOf } from '../cad/importStep'
import { ipcErrorDetail } from '../java/openScript'
import { closePreferences, useDialogStore, usePreferencesStore } from './dialogStore'
import { showNotice, type NoticeKey } from './noticeStore'
import TextField from './TextField'

// 창 안에서 Tab으로 도는 요소
const FOCUSABLE =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 외부 스크립트 편집기 선택 상자의 값
const SYSTEM = 'system'
const CUSTOM = 'custom'
const BROWSE = 'browse'
const DETECTED_PREFIX = 'detected:'

// 메인이 선택을 받지 않은 이유 → 알림 문구
const ERROR_NOTICES: Record<ExternalEditorError, NoticeKey> = {
  unsupportedFile: 'externalEditorUnsupportedFile',
  invalidArgs: 'externalEditorInvalidArgs'
}

function selectValue(state: ExternalEditorState): string {
  if (state.kind === 'detected' && state.detectedId) return DETECTED_PREFIX + state.detectedId
  return state.kind === 'custom' ? CUSTOM : SYSTEM
}

// Unity Preferences > External Tools > External Script Editor. 설정은 실행 파일 경로를 담으므로 메인 프로세스가
// 갖고(userData), 여기서는 고르기만 한다. 찾아보기 대화상자도 메인이 띄운다.
function ExternalToolsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = useState<ExternalEditorState | null>(null)
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
      .catch((error: unknown) =>
        showNotice('error', 'externalEditorFailed', { detail: ipcErrorDetail(error) })
      )
    return () => {
      mounted.current = false
    }
  }, [])

  const apply = async (choice: ExternalEditorChoice): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const next = await window.api.setExternalEditor(choice)
      // 받지 않았으면 설정은 그대로이고 이유가 붙어 온다
      if (next.error) showNotice('warning', ERROR_NOTICES[next.error])
      if (mounted.current) {
        setState(next)
        setError(next.error ?? null)
      }
    } catch (error) {
      showNotice('error', 'externalEditorFailed', { detail: ipcErrorDetail(error) })
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
    }
  }

  const onSelect = (value: string): void => {
    if (value === BROWSE)
      void apply({ kind: 'browse', title: t('preferences.externalTools.browseTitle') })
    else if (value === SYSTEM) void apply({ kind: 'system' })
    else if (value.startsWith(DETECTED_PREFIX))
      void apply({ kind: 'detected', id: value.slice(DETECTED_PREFIX.length) })
  }

  return (
    <section className="preferences-page" aria-labelledby="preferences-external-tools">
      <h2 id="preferences-external-tools" className="preferences-page-title">
        {t('preferences.externalTools.title')}
      </h2>
      {!state ? (
        <p className="inspector-note">{t('preferences.externalTools.loading')}</p>
      ) : (
        <>
          <label className="preferences-row">
            <span className="preferences-row-label">
              {t('preferences.externalTools.scriptEditor')}
            </span>
            <select
              className="field-select"
              value={selectValue(state)}
              aria-busy={pending || undefined}
              onChange={(event) => onSelect(event.target.value)}
            >
              <option value={SYSTEM}>{t('preferences.externalTools.openByExtension')}</option>
              {state.detected.map((editor) => (
                <option key={editor.id} value={DETECTED_PREFIX + editor.id}>
                  {editor.name}
                </option>
              ))}
              {/* 저장된 편집기를 이번에 찾지 못했으면(지웠거나 옮김) 실행 파일 이름으로 보인다 */}
              {state.kind === 'detected' &&
                state.detectedId &&
                !state.detected.some((editor) => editor.id === state.detectedId) && (
                  <option value={DETECTED_PREFIX + state.detectedId}>
                    {state.exe ? fileNameOf(state.exe) : state.detectedId}
                  </option>
                )}
              {state.kind === 'custom' && state.exe && (
                <option value={CUSTOM}>{fileNameOf(state.exe)}</option>
              )}
              <option value={BROWSE}>{t('preferences.externalTools.browse')}</option>
            </select>
          </label>
          {error && (
            <p className="preferences-error" role="alert">
              {t(`notice.${ERROR_NOTICES[error]}`)}
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
    </section>
  )
}

const CATEGORIES = ['externalTools'] as const
type Category = (typeof CATEGORIES)[number]

function PreferencesDialog(): React.JSX.Element {
  const { t } = useTranslation()
  const [category, setCategory] = useState<Category>('externalTools')
  const dialogRef = useRef<HTMLDivElement>(null)

  // 포커스: 열 때 창 안으로 옮기고, Tab은 창 안에서만 돌고, Esc로 닫으며, 닫으면 연 곳으로 돌려준다(DialogHost와 같음)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = (): HTMLElement[] =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    // 처음에는 고른 분류에 둔다
    ;(
      dialogRef.current?.querySelector<HTMLElement>('.preferences-category.is-active') ??
      focusable()[0]
    )?.focus()
    // 확인 대화상자(창 닫기 확인 등)가 위에 뜨면 키보드·포커스는 그 대화상자 몫이다
    const dialogOnTop = (): boolean => useDialogStore.getState().request !== null
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dialogOnTop()) return
      if (event.key === 'Escape') {
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
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        // 바깥(어두운 배경)을 누르면 닫는다
        if (event.target === event.currentTarget) closePreferences()
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
