import type { StepReadResult } from '../../../shared/ipc'

// 필드 CAD 읽기(spec-4e §3.3). loadCadWithProgress(cad/importStep.ts) 꼴: 한 번에 하나, 진행 알림·취소, 메시 캐시·
// 네이티브/WASM 그대로. 이 모듈과 fieldVisualActions는 projectActions를 import하지 않는다(순환 없음).
// 계약 단계(spec-4e §6)는 빈 함수다. 구현은 갈래 A다.

export type FieldVisualLoad = 'loaded' | 'missing' | 'failed' | 'cancelled'

export async function loadFieldVisualWithProgress(
  path: string,
  lookup?: StepReadResult
): Promise<FieldVisualLoad> {
  void path
  void lookup
  return 'cancelled'
}

// 읽은 결과를 그 경로의 상태 칸(projectStore.fieldVisualStatus)과 알림에 넣는다. 세션이 다르거나 지금 문서 visual의
// 경로가 아니면 아무것도 하지 않는다.
export function applyFieldVisualStatus(
  path: string,
  result: FieldVisualLoad,
  session: number
): void {
  void path
  void result
  void session
}
