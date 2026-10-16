import { create } from 'zustand'
import { canMoveObjects, selectionRoots } from '../scene/hierarchy'
import { childrenInDocument, findRobotId, type SceneObjects } from '../scene/model'

// 하이어라키 행 드래그 앤 드롭(부모 바꾸기·순서)의 순수 계산과 표시 상태. Vitest에 DOM이 없어 패널에서 뺐다.

// 하이어라키 안에서 끄는 오브젝트의 형식. 이 형식이 아닌 드래그(탐색기에서 끄는 STEP 파일 등)는 행이 건드리지 않고
// 창(EditorLayout)으로 올려 보낸다. 막으면 Electron이 그 파일로 페이지를 이동해 작업이 날아간다.
export const OBJECT_DRAG_TYPE = 'application/x-sandbot-object'

// 행 위 어디에 놓는지: 앞 형제, 자식(마지막), 뒤 형제
export type DropPosition = 'before' | 'into' | 'after'

// 행의 위·아래 이 비율은 형제 사이(앞·뒤), 가운데는 자식이다(Unity는 16 px 행의 위·아래 4 px).
const EDGE_RATIO = 0.25

// 행 안 세로 위치로 놓을 자리를 정한다. 자식을 받을 수 없는 행은 반으로 나눠 앞·뒤만 쓴다.
export function dropPosition(
  offsetY: number,
  rowHeight: number,
  canBeParent: boolean
): DropPosition {
  if (!canBeParent) return offsetY < rowHeight / 2 ? 'before' : 'after'
  const edge = rowHeight * EDGE_RATIO
  if (offsetY < edge) return 'before'
  if (offsetY >= rowHeight - edge) return 'after'
  return 'into'
}

export type DropDestination = { parentId: string | null; beforeId: string | null }

// 형제 목록에서 from 위치부터 처음으로 끌지 않는 형제(그 앞에 넣는다). 없으면 null(마지막).
function firstUndragged(
  siblings: readonly { id: string }[],
  from: number,
  dragged: ReadonlySet<string>
): string | null {
  for (let i = from; i < siblings.length; i++)
    if (!dragged.has(siblings[i].id)) return siblings[i].id
  return null
}

// 놓을 자리 → 새 부모와 기준 형제(그 앞에 넣는다, null이면 마지막).
// 펼친 부모의 '뒤'는 Unity처럼 첫 자식 앞이다(그 부모 바로 아래에 줄이 보인다).
// 기준 형제가 끄는 오브젝트면 그다음 형제를 쓴다(제자리에 놓으면 아무것도 바뀌지 않는다).
export function resolveDrop(
  objects: SceneObjects,
  draggedIds: readonly string[],
  targetId: string,
  position: DropPosition,
  expanded = false
): DropDestination | null {
  const target = objects[targetId]
  if (!target) return null
  const dragged = new Set(draggedIds)
  if (position === 'into') return { parentId: targetId, beforeId: null }
  const children = childrenInDocument(objects, targetId)
  if (position === 'after' && expanded && children.length > 0)
    return { parentId: targetId, beforeId: firstUndragged(children, 0, dragged) }
  const siblings = childrenInDocument(objects, target.parentId)
  const index = siblings.findIndex((sibling) => sibling.id === targetId)
  return {
    parentId: target.parentId,
    beforeId: firstUndragged(siblings, position === 'before' ? index : index + 1, dragged)
  }
}

// 행 아래 빈 공간에 놓을 때: 끄는 오브젝트들의 로봇 마지막 자식(모두 같은 로봇일 때). 로봇만 끌거나
// 로봇 밖 오브젝트만 끌면 최상위 마지막. 여러 로봇에 걸치면 놓을 수 없다.
export function resolveEmptySpaceDrop(
  objects: SceneObjects,
  draggedIds: readonly string[]
): DropDestination | null {
  const roots = selectionRoots(objects, draggedIds)
  if (roots.length === 0) return null
  if (roots.every((id) => objects[id].kind === 'robot')) return { parentId: null, beforeId: null }
  const robots = new Set(roots.map((id) => findRobotId(objects, id)))
  if (robots.size !== 1) return null
  const [robotId] = robots
  return { parentId: robotId, beforeId: null }
}

// 행에서 드래그를 시작할 때 끄는 오브젝트: 선택한 행이면 선택 전체, 아니면 그 행만(Unity와 같음).
// 보이는 행 순서로 정렬한다(옮긴 뒤 형제 순서가 화면 순서를 따르게). 보이지 않는 선택은 뒤에 둔다.
export function draggedIdsFor(
  rowId: string,
  selectedIds: readonly string[],
  visibleIds: readonly string[]
): string[] {
  if (!selectedIds.includes(rowId)) return [rowId]
  const order = new Map(visibleIds.map((id, index) => [id, index]))
  return [...selectedIds].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
}

export type RowDrop = DropDestination & { position: DropPosition }

// 드래그 중인 행 위 위치에서 놓을 수 있는 자리. 놓을 수 없으면 null(커서가 '안 됨'으로 보인다).
export function evaluateRowDrop(
  objects: SceneObjects,
  draggedIds: readonly string[],
  targetId: string,
  offsetY: number,
  rowHeight: number,
  expanded: boolean
): RowDrop | null {
  // 끄는 행 자신 위에서는 놓지 않는다(제자리라 바뀌는 것이 없다)
  if (!objects[targetId] || draggedIds.includes(targetId)) return null
  const canBeParent = canMoveObjects(objects, draggedIds, targetId, null)
  const position = dropPosition(offsetY, rowHeight, canBeParent)
  // 자식을 받을 수 없는 행은 펼쳐 있어도 '뒤'가 그 행의 뒤 형제다
  const destination = resolveDrop(objects, draggedIds, targetId, position, expanded && canBeParent)
  if (!destination) return null
  if (!canMoveObjects(objects, draggedIds, destination.parentId, destination.beforeId)) return null
  return { ...destination, position }
}

export function evaluateEmptySpaceDrop(
  objects: SceneObjects,
  draggedIds: readonly string[]
): DropDestination | null {
  const destination = resolveEmptySpaceDrop(objects, draggedIds)
  return destination && canMoveObjects(objects, draggedIds, destination.parentId, null)
    ? destination
    : null
}

// 드롭 표시: 행 앞·뒤 줄, 행 강조(자식으로), 또는 트리 끝 줄(최상위 마지막).
// nested는 펼친 부모의 '뒤'(첫 자식 앞)라 줄을 자식 깊이로 들여 그린다.
export type DropIndicator =
  { id: string; position: DropPosition; nested: boolean } | { id: null; position: 'end' }

type DragState = {
  indicator: DropIndicator | null
}

// 표시 상태만 스토어에 둔다. 행은 선택자로 자기 표시만 읽어, 드래그 중 표시가 바뀐 행만 다시 그린다.
export const useHierarchyDragStore = create<DragState>()(() => ({ indicator: null }))

export function setDropIndicator(indicator: DropIndicator | null): void {
  const current = useHierarchyDragStore.getState().indicator
  const nested = (value: DropIndicator | null): boolean =>
    value !== null && value.id !== null && value.nested
  if (
    current?.id === indicator?.id &&
    current?.position === indicator?.position &&
    nested(current) === nested(indicator)
  )
    return
  useHierarchyDragStore.setState({ indicator })
}

// 끄는 오브젝트 id. dragover에서는 dataTransfer.getData를 쓸 수 없어서 dragstart 때 여기에 둔다.
let draggedIds: readonly string[] | null = null

export function beginObjectDrag(ids: readonly string[]): void {
  draggedIds = ids
}

export function getDraggedIds(): readonly string[] | null {
  return draggedIds
}

export function endObjectDrag(): void {
  draggedIds = null
  setDropIndicator(null)
}

// 접힌 행 위에 잠시 머물면 펼친다(Unity와 같음). 같은 행 위에 있는 동안은 타이머를 다시 시작하지 않는다.
export type HoverExpander = { hover: (id: string | null) => void; cancel: () => void }

export function createHoverExpander(
  delay: number,
  expand: (id: string) => void,
  timers: {
    set: (callback: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  } = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
): HoverExpander {
  let hoveredId: string | null = null
  let handle: unknown = null
  const cancel = (): void => {
    if (handle !== null) timers.clear(handle)
    handle = null
    hoveredId = null
  }
  return {
    hover: (id) => {
      if (id === hoveredId) return
      cancel()
      if (id === null) return
      hoveredId = id
      handle = timers.set(() => {
        handle = null
        expand(id)
      }, delay)
    },
    cancel
  }
}
