import { MIN_JDK_MAJOR, type JdkChoice, type JdkInfo, type JdkState } from '../../../shared/play'

// 환경 설정 > 외부 도구 > JDK 선택 상자(Unity External Tools의 JDK 칸처럼). 설정은 메인 프로세스가 갖고
// (userData/jdk.json), 렌더러는 고른 항목만 setJdk로 보낸다. 찾아보기 대화상자도 메인이 띄운다.

const AUTO = 'auto'
export const JDK_BROWSE = 'browse'
const HOME_PREFIX = 'home:'

export type JdkOption =
  | { value: string; kind: 'auto' }
  | { value: string; kind: 'browse' }
  // 찾은 JDK(17 미만은 고를 수 없게 보인다)
  | { value: string; kind: 'jdk'; jdk: JdkInfo; usable: boolean }
  // 직접 고른 폴더인데 이번에 찾은 목록에 없다(지웠거나 옮김)
  | { value: string; kind: 'custom'; home: string }

export function jdkValue(state: JdkState): string {
  return state.choice.kind === 'auto' ? AUTO : HOME_PREFIX + state.choice.home
}

// 순서: 자동(권장), 찾은 JDK, (목록에 없는 직접 고른 폴더), 찾아보기…
export function jdkOptions(state: JdkState): JdkOption[] {
  const options: JdkOption[] = [{ value: AUTO, kind: 'auto' }]
  const seen = new Set<string>()
  for (const jdk of state.detected) {
    if (seen.has(jdk.home)) continue
    seen.add(jdk.home)
    options.push({
      value: HOME_PREFIX + jdk.home,
      kind: 'jdk',
      jdk,
      usable: jdk.major >= MIN_JDK_MAJOR
    })
  }
  if (state.choice.kind === 'custom' && !seen.has(state.choice.home))
    options.push({
      value: HOME_PREFIX + state.choice.home,
      kind: 'custom',
      home: state.choice.home
    })
  options.push({ value: JDK_BROWSE, kind: 'browse' })
  return options
}

// 고른 값 → 메인에 보낼 선택. 지금 설정과 같으면 null(바꿀 것이 없다).
export function jdkChoice(value: string, state: JdkState, browseTitle: string): JdkChoice | null {
  if (value === jdkValue(state)) return null
  if (value === JDK_BROWSE) return { kind: 'browse', title: browseTitle }
  if (value === AUTO) return { kind: 'auto' }
  if (value.startsWith(HOME_PREFIX) && value.length > HOME_PREFIX.length)
    return { kind: 'detected', home: value.slice(HOME_PREFIX.length) }
  return null
}
