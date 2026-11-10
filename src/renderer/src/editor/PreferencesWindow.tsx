import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ExternalEditorChoice,
  ExternalEditorError,
  ExternalEditorState
} from '../../../shared/ipc'
import { ipcErrorDetail, resetLineSupport } from '../java/openScript'
import AndroidSdkSection from '../play/ui/AndroidSdkSection'
import JdkSection from '../play/ui/JdkSection'
import SimulationPreferences from '../play/ui/SimulationPreferences'
import { closePreferences, usePreferencesStore } from './dialogStore'
import {
  EXTERNAL_EDITOR_BROWSE,
  EXTERNAL_EDITOR_ERROR_NOTICES,
  externalEditorChoice,
  externalEditorOptions,
  externalEditorValue
} from './externalEditorOptions'
import { dismissNotice, showNotice } from './noticeStore'
import SettingsDialog from './SettingsDialog'
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
      {/* 팀 코드를 컴파일할 Android SDK(프로젝트 compileSdk의 플랫폼 API) */}
      <AndroidSdkSection />
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
  return (
    <SettingsDialog
      title={t('preferences.title')}
      categories={CATEGORIES.map((id) => ({ id, label: t(`preferences.${id}.title`) }))}
      category={category}
      onCategory={setCategory}
      onClose={closePreferences}
      isOpen={() => usePreferencesStore.getState().open}
      initialFocus={(dialog) => {
        // JDK·Android SDK 칸을 열라고 했으면 그 칸으로 옮긴다
        const target = usePreferencesStore.getState().target
        const section =
          target === 'jdk' || target === 'androidSdk'
            ? dialog.querySelector<HTMLElement>(`[data-preferences-section="${target}"]`)
            : null
        section?.scrollIntoView({ block: 'nearest' })
        return section
      }}
    >
      {category === 'externalTools' && <ExternalToolsPage />}
      {category === 'simulation' && <SimulationPreferences />}
    </SettingsDialog>
  )
}

// 환경 설정 창(Unity의 Edit > Preferences). 툴바 버튼으로 열고, 열려 있는 동안 창 단축키는 쓰지 않는다(isModalOpen).
function PreferencesWindow(): React.JSX.Element | null {
  const open = usePreferencesStore((state) => state.open)
  return open ? <PreferencesDialog /> : null
}

export default PreferencesWindow
