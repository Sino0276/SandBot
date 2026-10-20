// 계약 자리(구현은 사용처 스토어 작업이 채운다). spec §4 Store state, §7.
// 사용처 스토어와 조율: 언제 읽고(javaIndex revision, 씬 기호 변경), 무엇을 워커에 넘기고, 결과를 어떻게 두는지.
import { create } from 'zustand'
import type { SceneObjects } from '../scene/model'
import type { FromWorker, ToWorker, UsageResult } from './usages/usageTypes'

// none: 프로젝트가 없다(임시 씬). noTeamCode: TeamCode 폴더가 없다. scanning: 찾는 중(이전 결과를 그대로 보인다).
// ready: 결과가 지금 씬·파일과 맞다. failed: 읽기·워커 실패(이전 결과를 흐리게 보인다).
export type UsageStatus = 'none' | 'noTeamCode' | 'scanning' | 'ready' | 'failed'

export type UsageIndexState = {
  status: UsageStatus
  root: string | null
  session: number
  result: UsageResult | null
  // result를 맞춘 기호표의 signature(지금 씬의 것과 같으면 최신)
  resultSignature: string | null
  // 찾을 때의 javaIndex.truncated(목록이 5000개 한도를 넘어 일부만 찾음)
  truncated: boolean
  // 마지막으로 열거나 저장한 씬(projectActions의 savedObjects). 이름 바꾸기를 그 카드에 "이전 이름"으로 붙인다.
  baseline: SceneObjects | null
  detail: string | null
}

export const INITIAL_USAGE_INDEX: UsageIndexState = {
  status: 'none',
  root: null,
  session: 0,
  result: null,
  resultSignature: null,
  truncated: false,
  baseline: null,
  detail: null
}

export const useUsageIndexStore = create<UsageIndexState>()(() => INITIAL_USAGE_INDEX)

// 워커 하나(테스트는 순수 함수로 만든 가짜를 넣는다)
export type UsageWorkerLike = {
  postMessage: (message: ToWorker) => void
  terminate: () => void
  onmessage: ((event: { data: FromWorker }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export function setUsageWorkerFactory(factory: () => UsageWorkerLike): void {
  void factory
}

// 프로젝트 세션을 시작할 때 한 번(initProjectSession). javaIndex·sceneStore·projectStore를 구독한다.
export function initUsageIndex(): void {
  // 구현 자리
}

// 이름 바꾸기를 붙일 기준 씬(열 때 경로를 고친 뒤, 저장한 뒤)
export function setUsageBaseline(objects: SceneObjects | null): void {
  useUsageIndexStore.setState({ baseline: objects })
}

// 저장해 생성 코드를 맞춘 뒤(generation synced): 저장한 씬으로 맞춘 결과를 기다려 깨지는 곳이 있으면 경고 알림 하나
export async function checkUsagesAfterSave(
  previous: SceneObjects | null,
  saved: SceneObjects
): Promise<void> {
  void previous
  void saved
}
