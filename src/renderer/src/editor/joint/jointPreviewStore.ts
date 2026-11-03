import { create } from 'zustand'

// 관절 카드의 미리보기 슬라이더 값(관절 오브젝트 id → q, rad 또는 m). 씬 뷰가 그 관절을 이 값으로 그리기만 하는 보기
// 상태라 씬 문서·실행 취소·저장·dirty에 들어가지 않는다(sceneVisibility와 같은 자리). 카드가 사라지면(선택이 바뀜, 카드
// 떼기) 그 값을 지운다. 실행 중 그 로봇의 관절은 시뮬레이터 값이 이긴다(poseDisplay.ts의 jointValueSource).

export type JointPreviewState = { values: Readonly<Record<string, number>> }

const EMPTY: Readonly<Record<string, number>> = {}

export const useJointPreviewStore = create<JointPreviewState>()(() => ({ values: EMPTY }))

export function setJointPreview(id: string, q: number): void {
  if (!Number.isFinite(q)) return
  const { values } = useJointPreviewStore.getState()
  if (values[id] === q) return
  useJointPreviewStore.setState({ values: { ...values, [id]: q } })
}

export function clearJointPreview(id: string): void {
  const { values } = useJointPreviewStore.getState()
  if (!Object.hasOwn(values, id)) return
  const next = { ...values }
  delete next[id]
  useJointPreviewStore.setState({ values: Object.keys(next).length === 0 ? EMPTY : next })
}

export function jointPreviewValue(state: JointPreviewState, id: string): number | null {
  return Object.hasOwn(state.values, id) ? state.values[id] : null
}
