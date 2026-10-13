import { create } from 'zustand'
import type { ReferenceFrame } from '../scene/model'

// 씬 뷰 도구(Unity와 같은 단축키): Q 손(왼쪽 드래그로 화면 이동), W 이동, E 회전
export type EditorTool = 'view' | 'translate' | 'rotate'

type EditorState = {
  selectedId: string | null
  // 필드/로봇 보기 전환. 축 표시·핸들 방향·인스펙터 값·카메라에 적용되고 저장 데이터는 바꾸지 않는다.
  frame: ReferenceFrame
  tool: EditorTool
  // 카메라를 이 오브젝트에 맞추라는 요청. 같은 오브젝트를 다시 요청해도 반응하도록 매번 새 객체를 만든다.
  focusRequest: { id: string } | null
  select: (id: string | null) => void
  focus: (id: string) => void
  setFrame: (frame: ReferenceFrame) => void
  setTool: (tool: EditorTool) => void
}

export const useEditorStore = create<EditorState>()((set) => ({
  selectedId: null,
  frame: 'field',
  tool: 'translate',
  focusRequest: null,
  select: (selectedId) => set({ selectedId }),
  focus: (id) => set({ focusRequest: { id } }),
  setFrame: (frame) => set({ frame }),
  setTool: (tool) => set({ tool })
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
