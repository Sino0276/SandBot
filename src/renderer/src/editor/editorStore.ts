import { create } from 'zustand'
// 씬 뷰 도구(Unity와 같은 단축키): Q 손(왼쪽 드래그로 화면 이동), W 이동, E 회전
export type EditorTool = 'view' | 'translate' | 'rotate'

// 이동·회전 핸들의 축 방향(Unity의 Global/Local). 전역은 필드 축, 로컬은 선택한 오브젝트 자신의 축이다.
export type HandleSpace = 'global' | 'local'

// 선택은 Unity 모델을 따른다. selectedIds는 선택 전체(선택한 순서), selectedId는 활성 오브젝트
// (Unity Selection.activeGameObject)다. 인스펙터·핸들·F·IMU 표시는 활성 오브젝트에만 적용한다.
// 선택이 있으면 활성 오브젝트는 항상 그 안에 있고, 선택이 비면 null이다.
type Selection = {
  selectedId: string | null
  selectedIds: readonly string[]
  // Shift+클릭 범위의 시작점. 일반 클릭·Ctrl+클릭한 오브젝트이고, Shift+클릭은 바꾸지 않는다.
  rangeAnchorId: string | null
  // 하이어라키에서 이름을 바꾸는 중인 오브젝트. 활성 오브젝트가 바뀌면 끝난다.
  renamingId: string | null
}

type EditorState = Selection & {
  // 핸들 방향에만 적용되고 저장 데이터·인스펙터 값은 바꾸지 않는다.
  handleSpace: HandleSpace
  tool: EditorTool
  // 카메라를 이 오브젝트에 맞추라는 요청. 같은 오브젝트를 다시 요청해도 반응하도록 매번 새 객체를 만든다.
  focusRequest: { id: string } | null
  // 하나만 선택한다(null이면 선택 해제)
  select: (id: string | null) => void
  // Ctrl+클릭: 선택에 넣거나 뺀다. 넣으면 활성 오브젝트가 되고, 활성 오브젝트를 빼면 남은 것 중 마지막이 활성이 된다.
  toggleSelect: (id: string) => void
  // Shift+클릭: 범위 시작점부터 id까지 보이는 행 순서(orderedVisibleIds)로 선택한다. id가 활성 오브젝트가 된다.
  selectRange: (id: string, orderedVisibleIds: readonly string[]) => void
  // 선택 전체를 바꾼다. activeId가 ids에 없으면 ids의 마지막이 활성이다.
  setSelection: (ids: readonly string[], activeId?: string | null) => void
  // 없어진 오브젝트를 선택·이름 바꾸기에서 뺀다(실행 취소로 씬이 바뀐 뒤 등)
  pruneSelection: (exists: (id: string) => boolean) => void
  setRenaming: (id: string | null) => void
  focus: (id: string) => void
  setHandleSpace: (space: HandleSpace) => void
  setTool: (tool: EditorTool) => void
}

// 선택 상태를 만든다. 활성 오브젝트가 바뀌면 이름 바꾸기는 끝낸다.
function selection(
  state: Selection,
  ids: readonly string[],
  activeId: string | null,
  rangeAnchorId: string | null = activeId
): Selection {
  const selectedIds = [...new Set(ids)]
  const selectedId =
    activeId !== null && selectedIds.includes(activeId)
      ? activeId
      : (selectedIds[selectedIds.length - 1] ?? null)
  return {
    selectedId,
    selectedIds,
    rangeAnchorId: selectedId === null ? null : rangeAnchorId,
    renamingId: state.renamingId === selectedId ? state.renamingId : null
  }
}

export const useEditorStore = create<EditorState>()((set) => ({
  selectedId: null,
  selectedIds: [],
  rangeAnchorId: null,
  renamingId: null,
  handleSpace: 'global',
  tool: 'translate',
  focusRequest: null,
  select: (id) => set((state) => selection(state, id === null ? [] : [id], id)),
  toggleSelect: (id) =>
    set((state) =>
      state.selectedIds.includes(id)
        ? selection(
            state,
            state.selectedIds.filter((selected) => selected !== id),
            state.selectedId === id ? null : state.selectedId,
            state.rangeAnchorId === id ? null : state.rangeAnchorId
          )
        : selection(state, [...state.selectedIds, id], id)
    ),
  selectRange: (id, orderedVisibleIds) =>
    set((state) => {
      const anchor = state.rangeAnchorId ?? state.selectedId
      const from = anchor === null ? -1 : orderedVisibleIds.indexOf(anchor)
      const to = orderedVisibleIds.indexOf(id)
      if (from < 0 || to < 0) return selection(state, [id], id)
      const range = orderedVisibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)
      return selection(state, range, id, anchor)
    }),
  setSelection: (ids, activeId = null) => set((state) => selection(state, ids, activeId)),
  pruneSelection: (exists) =>
    set((state) => {
      const kept = state.selectedIds.filter(exists)
      const renamingId =
        state.renamingId !== null && exists(state.renamingId) ? state.renamingId : null
      if (kept.length === state.selectedIds.length && renamingId === state.renamingId) return state
      const anchor =
        state.rangeAnchorId !== null && exists(state.rangeAnchorId) ? state.rangeAnchorId : null
      return selection(
        { ...state, renamingId },
        kept,
        state.selectedId !== null && exists(state.selectedId) ? state.selectedId : null,
        anchor
      )
    }),
  setRenaming: (renamingId) => set({ renamingId }),
  focus: (id) => set({ focusRequest: { id } }),
  setHandleSpace: (handleSpace) => set({ handleSpace }),
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

// 지금 보이는 변환 핸들(TransformControls). 카메라 조작이 Alt+드래그 동안 잠시 끄는 데 쓴다.
type Gizmo = { enabled: boolean }
let activeGizmo: Gizmo | null = null

export function setActiveGizmo(gizmo: Gizmo | null): void {
  activeGizmo = gizmo
}

export function getActiveGizmo(): Gizmo | null {
  return activeGizmo
}
