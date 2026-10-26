import i18n from 'i18next'
import {
  canCreateEmptyParent,
  extraRemovalIds,
  moveRejection,
  selectionRoots,
  type MoveRejection
} from '../scene/hierarchy'
import { childrenInDocument, findRobotId, subtreeIds, type SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { showDialog } from './dialogStore'
import { useEditorStore } from './editorStore'
import { revealObjects, searchRows, useHierarchyViewStore } from './hierarchyTree'
import { isChangeOpen } from './history'
import { showNotice, type NoticeKey } from './noticeStore'
import { toggleIsolation, toggleSelectionVisibility } from './sceneVisibility'
import { shortcutLabel } from './shortcuts'

// 하이어라키 편집 명령(단축키·우클릭 메뉴·헤더 버튼이 같이 쓴다). 모두 핸들을 드래그하는 중(isChangeOpen)에는
// 아무것도 하지 않는다. 드래그 묶음 중간에 씬이 바뀌면 실행 취소 단계가 어긋난다.

// 새 오브젝트를 둘 기본 부모(Unity의 Default Parent에 해당): 활성 오브젝트의 로봇, 없으면 첫 로봇, 그것도 없으면 최상위.
// SandBot의 오브젝트는 대부분 로봇에 속하고, 로봇 밖 그룹은 생성 코드에 들어가지 않기 때문이다.
export function defaultParentId(objects: SceneObjects, activeId: string | null): string | null {
  const robotId = activeId && objects[activeId] ? findRobotId(objects, activeId) : null
  if (robotId) return robotId
  return childrenInDocument(objects, null).find((object) => object.kind === 'robot')?.id ?? null
}

// 새 그룹을 선택하고 하이어라키에 보이게 한 뒤 이름 바꾸기를 시작한다(Unity와 같음)
function selectAndRename(id: string): void {
  revealObjects(useSceneStore.getState().objects, [id])
  const editor = useEditorStore.getState()
  editor.select(id)
  editor.setRenaming(id)
}

// parentId 아래 마지막에 빈 그룹을 만든다(우클릭한 행의 Create Empty). 만든 그룹 id.
export function createEmptyUnder(parentId: string | null): string | null {
  if (isChangeOpen()) return null
  const id = useSceneStore.getState().createGroup({ parentId })
  if (id !== null) selectAndRename(id)
  return id
}

// Create Empty(Ctrl+Shift+N, 헤더 [+], 빈 공간 우클릭): 기본 부모 아래 마지막
export function createEmpty(): string | null {
  const { objects } = useSceneStore.getState()
  return createEmptyUnder(defaultParentId(objects, useEditorStore.getState().selectedId))
}

// Create Empty Child(Alt+Shift+N): 활성 오브젝트의 자식. 선택이 없으면 Create Empty와 같다.
export function createEmptyChild(): string | null {
  const { selectedId } = useEditorStore.getState()
  if (selectedId === null || !useSceneStore.getState().objects[selectedId]) return createEmpty()
  return createEmptyUnder(selectedId)
}

// Create Empty Parent(Ctrl+Shift+G): 같은 부모를 가진 선택을 새 그룹으로 묶는다. 그룹을 펼쳐 이름 바꾸기를 시작한다.
export function createEmptyParent(): string | null {
  if (isChangeOpen()) return null
  const { selectedIds, selectedId } = useEditorStore.getState()
  if (!canCreateEmptyParent(useSceneStore.getState().objects, selectedIds)) return null
  const id = useSceneStore.getState().createEmptyParent(selectedIds, selectedId)
  if (id === null) return null
  useHierarchyViewStore.getState().setOpen([id], true)
  selectAndRename(id)
  return id
}

// 이름 바꾸기(F2). Unity처럼 하나만 선택했을 때만 한다.
export function renameSelection(): boolean {
  if (isChangeOpen()) return false
  const { selectedIds, selectedId, setRenaming } = useEditorStore.getState()
  if (selectedIds.length !== 1 || selectedId === null) return false
  if (!useSceneStore.getState().objects[selectedId]) return false
  revealObjects(useSceneStore.getState().objects, [selectedId])
  setRenaming(selectedId)
  return true
}

export type DeletePlan = {
  // 지울 선택(다른 선택의 하위는 뺀다)
  ids: string[]
  // 선택 subtree 밖에서 함께 지워지는 오브젝트(다른 그룹으로 옮긴, 지우는 CAD의 파트와 그 하위)
  extraIds: string[]
  // extraIds에 붙은 하드웨어 컴포넌트 수
  extraComponents: number
}

export function deletePlan(objects: SceneObjects, selectedIds: readonly string[]): DeletePlan {
  const ids = selectionRoots(objects, selectedIds)
  const extraIds = extraRemovalIds(objects, ids)
  const extraComponents = extraIds.reduce(
    (count, id) => count + (objects[id]?.components?.length ?? 0),
    0
  )
  return { ids, extraIds, extraComponents }
}

// 선택 삭제(Delete). 지우는 CAD 루트에서 다른 그룹으로 옮긴 파트도 함께 지워지면 먼저 묻는다(Ctrl+Z로 되돌릴 수 있다).
// 확인한 뒤 지울 대상을 다시 계산하고, 그다음에 선택을 푼다(취소하면 선택은 그대로다).
export async function deleteSelection(): Promise<boolean> {
  if (isChangeOpen()) return false
  const selection = useEditorStore.getState().selectedIds
  const plan = deletePlan(useSceneStore.getState().objects, selection)
  if (plan.ids.length === 0) return false
  if (plan.extraIds.length > 0) {
    const params = { count: plan.extraIds.length, undo: shortcutLabel('undo') }
    const message =
      plan.extraComponents > 0
        ? i18n.t('dialog.deleteWithCadParts', { ...params, components: plan.extraComponents })
        : i18n.t('dialog.deleteWithCadPartsNoHardware', params)
    const answer = await showDialog({
      message,
      buttons: [
        { id: 'delete', label: i18n.t('dialog.delete'), primary: true },
        { id: 'cancel', label: i18n.t('dialog.cancel') }
      ],
      cancelId: 'cancel'
    })
    if (answer !== 'delete' || isChangeOpen()) return false
  }
  // 대화상자를 띄운 동안 씬이 바뀌었을 수 있다(형상 다시 찾기 등). 지금 씬에 남은 것만 지운다.
  const ids = selectionRoots(useSceneStore.getState().objects, plan.ids)
  if (ids.length === 0) return false
  // 하이어라키에서 지웠으면 지운 행 대신 트리의 탭 위치 행으로 포커스를 옮겨 화살표 키가 계속 동작하게 한다(Unity와 같음)
  const refocusTree =
    typeof document !== 'undefined' &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement.closest('[role="tree"]') !== null
  useEditorStore.getState().select(null)
  useSceneStore.getState().removeObjects(ids)
  if (refocusTree) {
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[role="tree"] [role="treeitem"][tabindex="0"]')
        ?.focus({ preventScroll: true })
    )
  }
  return true
}

// ---- 선택 명령 ----

// Select All(Ctrl+A): 모든 오브젝트(문서 순서). 검색 중이면 검색 결과만(보이는 행을 고르는 것이 자연스럽다).
// 활성 오브젝트가 들어 있으면 그대로 둔다.
export function selectAll(): boolean {
  const { objects } = useSceneStore.getState()
  const rows = searchRows(objects, useHierarchyViewStore.getState().query)
  const ids = rows
    ? rows.map((row) => row.id)
    : childrenInDocument(objects, null).flatMap((object) => subtreeIds(objects, object.id))
  if (ids.length === 0) return false
  const { selectedId, setSelection } = useEditorStore.getState()
  setSelection(ids, selectedId !== null && ids.includes(selectedId) ? selectedId : ids[0])
  return true
}

// Select Children(Unity 하이어라키 메뉴): 선택과 그 하위 전체. 활성 오브젝트는 그대로다.
export function selectChildren(): boolean {
  const { objects } = useSceneStore.getState()
  const { selectedIds, selectedId, setSelection } = useEditorStore.getState()
  const roots = selectedIds.filter((id) => objects[id])
  if (roots.length === 0) return false
  const ids = [...new Set(roots.flatMap((id) => subtreeIds(objects, id)))]
  revealObjects(objects, ids)
  setSelection(ids, selectedId)
  return true
}

// ---- 잘라내기·붙여넣기(부모 바꾸기) ----

// 잘라내기(Ctrl+X). 씬은 붙여넣을 때 바뀐다. 다른 선택의 하위는 그 선택과 함께 옮겨지므로 뺀다.
export function cutSelection(): boolean {
  if (isChangeOpen()) return false
  const { objects } = useSceneStore.getState()
  const ids = selectionRoots(objects, useEditorStore.getState().selectedIds)
  if (ids.length === 0) return false
  useEditorStore.getState().setCut(ids)
  return true
}

export type PasteTarget = { parentId: string | null; beforeId: string | null }

// 붙일 자리. 자식으로(Ctrl+Shift+V, Unity의 Paste As Child)는 활성 오브젝트의 마지막 자식, 아니면(Ctrl+V) 활성
// 오브젝트 바로 다음 형제(Unity와 같음). 옮기는 오브젝트는 기준 형제가 될 수 없어 그다음 것을 쓴다.
export function pasteTarget(
  objects: SceneObjects,
  activeId: string,
  moving: readonly string[],
  asChild: boolean
): PasteTarget | null {
  const active = objects[activeId]
  if (!active) return null
  if (asChild) return { parentId: activeId, beforeId: null }
  const siblings = childrenInDocument(objects, active.parentId)
  const index = siblings.findIndex((object) => object.id === activeId)
  const movingSet = new Set(moving)
  const next = siblings.slice(index + 1).find((object) => !movingSet.has(object.id))
  return { parentId: active.parentId, beforeId: next?.id ?? null }
}

const PASTE_REJECTION: Record<MoveRejection, NoticeKey> = {
  empty: 'pasteRejectedMissing',
  missing: 'pasteRejectedMissing',
  before: 'pasteRejectedMissing',
  robot: 'pasteRejectedRobot',
  cadRoot: 'pasteRejectedCadRoot',
  otherRobot: 'pasteRejectedOtherRobot',
  descendant: 'pasteRejectedDescendant'
}

// 붙여넣기. 잘라낸 것이 없거나 활성 오브젝트가 없으면 false. 옮길 수 없으면(이동 규칙, moveRejection) 이유를 알리고
// 잘라낸 것은 그대로 둔다. 옮기면 실행 취소 한 단계이고, 옮긴 것을 선택해 보이게 한다.
export function pasteCut(asChild: boolean): boolean {
  if (isChangeOpen()) return false
  const { objects } = useSceneStore.getState()
  const editor = useEditorStore.getState()
  const ids = selectionRoots(objects, editor.cutIds)
  if (ids.length === 0 || editor.selectedId === null) return false
  const target = pasteTarget(objects, editor.selectedId, ids, asChild)
  if (!target) return false
  const rejection = moveRejection(objects, ids, target.parentId, target.beforeId)
  if (rejection) {
    showNotice('warning', PASTE_REJECTION[rejection])
    return false
  }
  useSceneStore.getState().moveObjects(ids, target.parentId, target.beforeId)
  editor.setCut([])
  revealObjects(useSceneStore.getState().objects, ids)
  useEditorStore.getState().setSelection(ids, ids[0])
  return true
}

// ---- 보이기·숨기기(씬 뷰에서만, sceneVisibility) ----

// H: 선택을 숨기거나 보인다
export function toggleSelectedVisibility(): boolean {
  return toggleSelectionVisibility(
    useSceneStore.getState().objects,
    useEditorStore.getState().selectedIds
  )
}

// Shift+H: 고립 보기 켜기·끄기
export function toggleSelectedIsolation(): boolean {
  return toggleIsolation(useSceneStore.getState().objects, useEditorStore.getState().selectedIds)
}

export type HierarchyMenuItem =
  | 'cut'
  | 'paste'
  | 'pasteAsChild'
  | 'rename'
  | 'delete'
  | 'selectChildren'
  | 'createEmpty'
  | 'createEmptyParent'

// 하이어라키 우클릭 메뉴의 항목과 사용 가능 여부(Unity SceneHierarchy 순서: Cut, Paste, Paste As Child | Rename,
// Delete | Select Children | Create Empty, Create Empty Parent). 복사·복제는 없다(CAD 파트는 CAD에서 온다).
// 행에서 열면 그 행이 이미 선택에 들어 있다. 빈 공간에서 열면 만들기만 있다.
// Unity 메뉴에 Create Empty Child는 없다(행의 Create Empty가 이미 그 행의 자식을 만든다). Alt+Shift+N으로만 쓴다.
export function hierarchyMenuState(
  objects: SceneObjects,
  selectedIds: readonly string[],
  onRow: boolean,
  cutIds: readonly string[] = [],
  activeId: string | null = null
): { item: HierarchyMenuItem; enabled: boolean; separatorBefore?: boolean }[] {
  if (!onRow) return [{ item: 'createEmpty', enabled: true }]
  const existing = selectedIds.filter((id) => objects[id])
  const cut = selectionRoots(objects, cutIds)
  const canPaste = (asChild: boolean): boolean => {
    if (cut.length === 0 || activeId === null || !objects[activeId]) return false
    const target = pasteTarget(objects, activeId, cut, asChild)
    return target !== null && moveRejection(objects, cut, target.parentId, target.beforeId) === null
  }
  return [
    { item: 'cut', enabled: existing.length > 0 },
    { item: 'paste', enabled: canPaste(false) },
    { item: 'pasteAsChild', enabled: canPaste(true) },
    { item: 'rename', enabled: existing.length === 1, separatorBefore: true },
    { item: 'delete', enabled: existing.length > 0 },
    {
      item: 'selectChildren',
      enabled: existing.some((id) => childrenInDocument(objects, id).length > 0),
      separatorBefore: true
    },
    { item: 'createEmpty', enabled: true, separatorBefore: true },
    { item: 'createEmptyParent', enabled: canCreateEmptyParent(objects, existing) }
  ]
}
