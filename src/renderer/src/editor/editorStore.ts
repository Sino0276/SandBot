import { create } from 'zustand'
import type { ReferenceFrame } from '../scene/model'

export type TransformMode = 'translate' | 'rotate'

type EditorState = {
  selectedId: string | null
  // 필드/로봇 보기 전환. 축 표시·핸들 방향·인스펙터 값·카메라에 적용되고 저장 데이터는 바꾸지 않는다.
  frame: ReferenceFrame
  transformMode: TransformMode
  select: (id: string | null) => void
  setFrame: (frame: ReferenceFrame) => void
  setTransformMode: (mode: TransformMode) => void
}

export const useEditorStore = create<EditorState>()((set) => ({
  selectedId: null,
  frame: 'field',
  transformMode: 'translate',
  select: (selectedId) => set({ selectedId }),
  setFrame: (frame) => set({ frame }),
  setTransformMode: (transformMode) => set({ transformMode })
}))

// 변환 핸들을 클릭하면 R3F는 오브젝트를 맞히지 못한 클릭(pointer missed)으로 보고 선택을 해제한다.
// 핸들을 조작한 직후의 빗나간 클릭은 무시하기 위해 마지막 조작 시각을 기록한다.
let lastHandleInteraction = 0

export function markHandleInteraction(): void {
  lastHandleInteraction = performance.now()
}

export function isRecentHandleInteraction(): boolean {
  return performance.now() - lastHandleInteraction < 300
}
