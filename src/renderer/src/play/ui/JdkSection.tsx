import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MIN_JDK_MAJOR, type JdkChoice, type JdkState } from '../../../../shared/play'
import { ipcErrorDetail } from '../../java/ipcError'
import { jdkChoice, jdkOptions, jdkValue, JDK_BROWSE, type JdkOption } from '../jdkOptions'

// 닫힌 선택 상자에서 값을 바로 바꾸는 키(Windows). 이 키로 [찾아보기…]에 닿으면 폴더 대화상자를 열지 않는다.
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

// 환경 설정 > 외부 도구의 JDK 칸(Unity External Tools의 JDK처럼). 실행(사이드카)에 쓸 JDK를 고른다.
// 자동은 Android Studio의 jbr → JAVA_HOME → PATH 순으로 찾은 첫 JDK다. 창을 열 때마다 메인이 다시 찾는다.
function JdkSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = useState<JdkState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const mounted = useRef(true)
  const keyChange = useRef(false)

  useEffect(() => {
    mounted.current = true
    window.api
      .getJdk()
      .then((next) => {
        if (mounted.current) setState(next)
      })
      .catch((error: unknown) => {
        if (mounted.current) setLoadError(ipcErrorDetail(error))
      })
    return () => {
      mounted.current = false
    }
  }, [])

  const apply = async (choice: JdkChoice): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setApplyError(null)
    try {
      const next = await window.api.setJdk(choice)
      if (mounted.current) setState(next)
    } catch (error) {
      if (mounted.current) setApplyError(ipcErrorDetail(error))
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
    }
  }

  const onSelect = (value: string): void => {
    const byKey = keyChange.current
    keyChange.current = false
    if (!state || (value === JDK_BROWSE && byKey)) return
    const choice = jdkChoice(value, state, t('preferences.jdk.browseTitle'))
    if (choice) void apply(choice)
  }

  const optionText = (option: JdkOption): string => {
    switch (option.kind) {
      case 'auto':
        return t('preferences.jdk.auto')
      case 'browse':
        return t('preferences.jdk.browse')
      case 'custom':
        return option.home
      case 'jdk':
        return t(option.usable ? 'preferences.jdk.option' : 'preferences.jdk.optionTooOld', {
          version: option.jdk.version,
          source: t(`preferences.jdk.sources.${option.jdk.source}`),
          home: option.jdk.home,
          min: MIN_JDK_MAJOR
        })
    }
  }

  return (
    <section
      className="preferences-subsection"
      aria-labelledby="preferences-jdk"
      data-preferences-section="jdk"
      tabIndex={-1}
    >
      <h3 id="preferences-jdk" className="preferences-subtitle">
        {t('preferences.jdk.title')}
      </h3>
      {!state ? (
        <p className={loadError ? 'preferences-error' : 'inspector-note'}>
          {loadError
            ? t('preferences.jdk.loadFailed', { detail: loadError })
            : t('preferences.jdk.loading')}
        </p>
      ) : (
        <>
          <label className="preferences-row">
            <span className="preferences-row-label">{t('preferences.jdk.label')}</span>
            <select
              className="field-select"
              value={jdkValue(state)}
              aria-busy={pending || undefined}
              onKeyDown={(event) => {
                keyChange.current = event.key.length === 1 || SELECT_MOVE_KEYS.has(event.key)
              }}
              onChange={(event) => onSelect(event.target.value)}
            >
              {jdkOptions(state).map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.kind === 'jdk' && !option.usable}
                >
                  {optionText(option)}
                </option>
              ))}
            </select>
          </label>
          {state.error && (
            <p className="preferences-error" role="alert">
              {t(`preferences.jdk.errors.${state.error}`, { min: MIN_JDK_MAJOR })}
            </p>
          )}
          {applyError && (
            <p className="preferences-error" role="alert">
              {t('preferences.jdk.applyFailed', { detail: applyError })}
            </p>
          )}
          {state.active ? (
            <div className="preferences-row">
              <span className="preferences-row-label">{t('preferences.jdk.active')}</span>
              <code className="hw-path preferences-exe" title={state.active.home}>
                {t('preferences.jdk.activeValue', {
                  version: state.active.version,
                  source: t(`preferences.jdk.sources.${state.active.source}`),
                  home: state.active.home
                })}
              </code>
            </div>
          ) : (
            <p className="preferences-error">
              {t(
                state.choice.kind === 'auto'
                  ? 'preferences.jdk.none'
                  : 'preferences.jdk.customMissing',
                {
                  min: MIN_JDK_MAJOR
                }
              )}
            </p>
          )}
          <p className="inspector-note">{t('preferences.jdk.hint', { min: MIN_JDK_MAJOR })}</p>
        </>
      )}
    </section>
  )
}

export default JdkSection
