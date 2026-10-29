import type { AndroidSdkChoice, AndroidSdkInfo, AndroidSdkState } from '../../../shared/play'

// 환경 설정 > 외부 도구 > Android SDK 선택 상자(JDK 칸과 같은 방식, jdkOptions.ts). 설정은 메인 프로세스가 갖고
// (userData/android-sdk.json), 렌더러는 고른 항목만 setAndroidSdk로 보낸다. 찾아보기 대화상자도 메인이 띄운다.

const AUTO = 'auto'
export const ANDROID_SDK_BROWSE = 'browse'
const HOME_PREFIX = 'home:'

export type AndroidSdkOption =
  | { value: string; kind: 'auto' }
  | { value: string; kind: 'browse' }
  // 찾은 SDK
  | { value: string; kind: 'sdk'; sdk: AndroidSdkInfo }
  // 직접 고른 폴더인데 이번에 찾은 목록에 없다(목록 밖 위치이거나 지웠음)
  | { value: string; kind: 'custom'; home: string }

export function androidSdkValue(state: AndroidSdkState): string {
  return state.choice.kind === 'auto' ? AUTO : HOME_PREFIX + state.choice.home
}

// 순서: 자동(권장), 찾은 SDK, (목록에 없는 직접 고른 폴더), 찾아보기…
export function androidSdkOptions(state: AndroidSdkState): AndroidSdkOption[] {
  const options: AndroidSdkOption[] = [{ value: AUTO, kind: 'auto' }]
  const seen = new Set<string>()
  for (const sdk of state.detected) {
    if (seen.has(sdk.home)) continue
    seen.add(sdk.home)
    options.push({ value: HOME_PREFIX + sdk.home, kind: 'sdk', sdk })
  }
  if (state.choice.kind === 'custom' && !seen.has(state.choice.home))
    options.push({
      value: HOME_PREFIX + state.choice.home,
      kind: 'custom',
      home: state.choice.home
    })
  options.push({ value: ANDROID_SDK_BROWSE, kind: 'browse' })
  return options
}

// 고른 값 → 메인에 보낼 선택. 지금 설정과 같으면 null(바꿀 것이 없다).
export function androidSdkChoice(
  value: string,
  state: AndroidSdkState,
  browseTitle: string
): AndroidSdkChoice | null {
  if (value === androidSdkValue(state)) return null
  if (value === ANDROID_SDK_BROWSE) return { kind: 'browse', title: browseTitle }
  if (value === AUTO) return { kind: 'auto' }
  if (value.startsWith(HOME_PREFIX) && value.length > HOME_PREFIX.length)
    return { kind: 'detected', home: value.slice(HOME_PREFIX.length) }
  return null
}

// 설치된 플랫폼 목록 글자('android-30, android-36.1'). 메인이 준 폴더 이름과 순서 그대로. 없으면 ''.
export function platformList(platforms: string[]): string {
  return platforms.join(', ')
}
