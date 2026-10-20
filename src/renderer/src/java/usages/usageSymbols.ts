// 계약 자리(구현은 사용처 핵심 작업이 채운다). spec §6.1.
import type { SceneObjects } from '../../scene/model'
import type { UsageKey, UsageSymbols } from './usageTypes'

// 씬 → 워커에 넘길 생성 클래스 기호표. objects마다 한 번 만든다(WeakMap). 이름은 codeScopes에서만 가져온다.
export function usageSymbols(objects: SceneObjects): UsageSymbols {
  void objects
  throw new Error('usageSymbols: not implemented')
}

// 모든 로봇 장치의 찾기 이름(앞뒤 공백 뺀 구성 이름, 데드휠은 같은 포트 모터의 이름) → 장치 키들
export function lookupNamesOf(objects: SceneObjects): Map<string, UsageKey[]> {
  void objects
  throw new Error('lookupNamesOf: not implemented')
}
