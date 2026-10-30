import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AndroidSdkChoice, AndroidSdkState } from '../../../../shared/play'
import { ipcErrorDetail } from '../../java/ipcError'
import { useProjectStore } from '../../project/projectStore'
import {
  ANDROID_SDK_BROWSE,
  androidSdkChoice,
  androidSdkOptions,
  androidSdkValue,
  platformList,
  type AndroidSdkOption
} from '../androidSdkOptions'

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

// 환경 설정 > 외부 도구의 Android SDK 칸(JDK 칸 옆). 팀 코드는 Android Studio처럼 프로젝트 compileSdk 플랫폼의 Java API로
// 컴파일하므로 그 플랫폼이 든 SDK를 고른다. 자동은 프로젝트 local.properties의 sdk.dir → ANDROID_HOME·ANDROID_SDK_ROOT →
// OS 기본 위치 순으로 찾은 첫 SDK다. 창을 열 때마다(그리고 프로젝트가 바뀌면) 메인이 다시 찾는다.
function AndroidSdkSection(): React.JSX.Element {
  const { t } = useTranslation()
  const root = useProjectStore((state) => state.root)
  const [state, setState] = useState<AndroidSdkState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const mounted = useRef(true)
  const keyChange = useRef(false)

  useEffect(() => {
    mounted.current = true
    // 늦게 온 이전 프로젝트의 결과는 버린다
    let current = true
    window.api
      .getAndroidSdk(root)
      .then((next) => {
        if (mounted.current && current) setState(next)
      })
      .catch((error: unknown) => {
        if (mounted.current && current) setLoadError(ipcErrorDetail(error))
      })
    return () => {
      current = false
      mounted.current = false
    }
  }, [root])

  const apply = async (choice: AndroidSdkChoice): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setApplyError(null)
    try {
      const next = await window.api.setAndroidSdk(choice, root)
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
    if (!state || (value === ANDROID_SDK_BROWSE && byKey)) return
    const choice = androidSdkChoice(value, state, t('preferences.androidSdk.browseTitle'))
    if (choice) void apply(choice)
  }

  const platformsText = (platforms: string[]): string =>
    platforms.length === 0 ? t('preferences.androidSdk.noPlatforms') : platformList(platforms)

  const optionText = (option: AndroidSdkOption): string => {
    switch (option.kind) {
      case 'auto':
        return t('preferences.androidSdk.auto')
      case 'browse':
        return t('preferences.androidSdk.browse')
      case 'custom':
        return option.home
      case 'sdk':
        return t('preferences.androidSdk.option', {
          source: t(`preferences.androidSdk.sources.${option.sdk.source}`),
          home: option.sdk.home,
          platforms: platformsText(option.sdk.platforms)
        })
    }
  }

  return (
    <section
      className="preferences-subsection"
      aria-labelledby="preferences-android-sdk"
      data-preferences-section="androidSdk"
      tabIndex={-1}
    >
      <h3 id="preferences-android-sdk" className="preferences-subtitle">
        {t('preferences.androidSdk.title')}
      </h3>
      {!state ? (
        <p className={loadError ? 'preferences-error' : 'inspector-note'}>
          {loadError
            ? t('preferences.androidSdk.loadFailed', { detail: loadError })
            : t('preferences.androidSdk.loading')}
        </p>
      ) : (
        <>
          <label className="preferences-row">
            <span className="preferences-row-label">{t('preferences.androidSdk.label')}</span>
            <select
              className="field-select"
              value={androidSdkValue(state)}
              aria-busy={pending || undefined}
              onKeyDown={(event) => {
                keyChange.current = event.key.length === 1 || SELECT_MOVE_KEYS.has(event.key)
              }}
              onChange={(event) => onSelect(event.target.value)}
            >
              {androidSdkOptions(state).map((option) => (
                <option key={option.value} value={option.value}>
                  {optionText(option)}
                </option>
              ))}
            </select>
          </label>
          {state.error && (
            <p className="preferences-error" role="alert">
              {t(`preferences.androidSdk.errors.${state.error}`)}
            </p>
          )}
          {applyError && (
            <p className="preferences-error" role="alert">
              {t('preferences.androidSdk.applyFailed', { detail: applyError })}
            </p>
          )}
          {state.active ? (
            <>
              <div className="preferences-row">
                <span className="preferences-row-label">{t('preferences.androidSdk.active')}</span>
                <code className="hw-path preferences-exe" title={state.active.home}>
                  {t('preferences.androidSdk.activeValue', {
                    source: t(`preferences.androidSdk.sources.${state.active.source}`),
                    home: state.active.home
                  })}
                </code>
              </div>
              <div className="preferences-row">
                <span className="preferences-row-label">
                  {t('preferences.androidSdk.platforms')}
                </span>
                <code className="hw-path preferences-exe">
                  {platformsText(state.active.platforms)}
                </code>
              </div>
            </>
          ) : (
            <p className="preferences-error">
              {t(
                state.choice.kind === 'auto'
                  ? 'preferences.androidSdk.none'
                  : 'preferences.androidSdk.customMissing'
              )}
            </p>
          )}
          <p className="inspector-note">{t('preferences.androidSdk.hint')}</p>
        </>
      )}
    </section>
  )
}

export default AndroidSdkSection
