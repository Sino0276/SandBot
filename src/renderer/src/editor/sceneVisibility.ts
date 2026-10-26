import { create } from 'zustand'
import { childrenInDocument, subtreeIds, type SceneObjects } from '../scene/model'

// 씬 뷰 보이기·숨기기와 고립 보기(Unity의 Scene Visibility: 하이어라키의 눈 아이콘, H, Shift+H).
// 화면에서만 숨기는 보기 상태라 씬 문서·실행 취소·저장·생성 코드에 들어가지 않는다. 숨긴 오브젝트는 그리지 않고
// 클릭으로 고를 수도 없다(하이어라키에서는 고를 수 있다). 숨김은 오브젝트마다 따로다(Unity와 같음). 부모를 숨겨도
// 자식의 표시는 자식 자신의 값이고, 눈 아이콘·H가 하위 전체에 같은 값을 둔다.

type VisibilityState = {
  // 숨긴 오브젝트(자신만). 지워진 오브젝트의 id가 남아도 쓰지 않는다.
  hidden: ReadonlySet<string>
  // 고립 보기 중이면 그 대상(이 오브젝트들과 하위만 보인다), 아니면 null
  isolated: readonly string[] | null
}

const EMPTY: ReadonlySet<string> = new Set()

export const useSceneVisibilityStore = create<VisibilityState>()(() => ({
  hidden: EMPTY,
  isolated: null
}))

// 프로젝트를 새로 열면 보기 상태를 버린다(다른 씬의 id다)
export function resetSceneVisibility(): void {
  useSceneVisibilityStore.setState({ hidden: EMPTY, isolated: null })
}

// 고립 대상과 그 하위(고립 중이 아니면 null). 고립 대상 배열마다 한 번 만든다.
const isolationSets = new WeakMap<readonly string[], WeakMap<SceneObjects, ReadonlySet<string>>>()

export function isolationSet(
  objects: SceneObjects,
  isolated: readonly string[] | null
): ReadonlySet<string> | null {
  if (!isolated) return null
  let byObjects = isolationSets.get(isolated)
  if (!byObjects) {
    byObjects = new WeakMap()
    isolationSets.set(isolated, byObjects)
  }
  let set = byObjects.get(objects)
  if (!set) {
    const ids = new Set<string>()
    for (const id of isolated)
      if (objects[id]) for (const sub of subtreeIds(objects, id)) ids.add(sub)
    set = ids
    byObjects.set(objects, set)
  }
  return set
}

// 씬 뷰에서 그리지 않는가(자신을 숨겼거나, 고립 보기 밖)
export function isHiddenInScene(
  state: VisibilityState,
  objects: SceneObjects,
  id: string
): boolean {
  if (state.hidden.has(id)) return true
  const isolation = isolationSet(objects, state.isolated)
  return isolation !== null && !isolation.has(id)
}

// 하이어라키 눈 아이콘: 보임, 숨김(자신), 일부 숨김(자신은 보이는데 하위 중 숨긴 것이 있음)
export type RowVisibility = 'visible' | 'hidden' | 'mixed'

const rowVisibilityMemo = new WeakMap<
  SceneObjects,
  WeakMap<ReadonlySet<string>, Map<string, RowVisibility>>
>()

// 보임이 아닌 행만 담은 표. 씬 문서·숨김 집합마다 한 번 만든다(큰 CAD에서 행마다 하위를 훑지 않게).
export function rowVisibilities(
  objects: SceneObjects,
  hidden: ReadonlySet<string>
): ReadonlyMap<string, RowVisibility> {
  let byHidden = rowVisibilityMemo.get(objects)
  if (!byHidden) {
    byHidden = new WeakMap()
    rowVisibilityMemo.set(objects, byHidden)
  }
  const cached = byHidden.get(hidden)
  if (cached) return cached
  const result = new Map<string, RowVisibility>()
  if (hidden.size > 0) {
    const visited = new Set<string>()
    // 하위(자신 제외)에 숨긴 것이 있는가
    const walk = (id: string): boolean => {
      let below = false
      for (const child of childrenInDocument(objects, id)) {
        if (visited.has(child.id)) continue
        visited.add(child.id)
        if (walk(child.id) || hidden.has(child.id)) below = true
      }
      if (hidden.has(id)) result.set(id, 'hidden')
      else if (below) result.set(id, 'mixed')
      return below
    }
    for (const root of childrenInDocument(objects, null)) {
      visited.add(root.id)
      walk(root.id)
    }
  }
  byHidden.set(hidden, result)
  return result
}

// 눈 아이콘 클릭: 숨김이면 보이고, 아니면 숨긴다. 하위 전체에 같은 값을 둔다(onlySelf면 그 오브젝트만, Unity의 Alt+클릭).
export function toggleRowVisibility(objects: SceneObjects, id: string, onlySelf: boolean): void {
  if (!objects[id]) return
  const { hidden } = useSceneVisibilityStore.getState()
  setHidden(onlySelf ? [id] : subtreeIds(objects, id), !hidden.has(id))
}

// H: 선택을 숨기거나 보인다. 선택이 모두 보이면 숨기고, 하나라도 숨겼으면 모두 보인다(Unity와 같음). 하위도 함께.
export function toggleSelectionVisibility(objects: SceneObjects, ids: readonly string[]): boolean {
  const existing = ids.filter((id) => objects[id])
  if (existing.length === 0) return false
  const { hidden } = useSceneVisibilityStore.getState()
  const hide = existing.every((id) => !hidden.has(id))
  setHidden(
    existing.flatMap((id) => subtreeIds(objects, id)),
    hide
  )
  return true
}

function setHidden(ids: readonly string[], hide: boolean): void {
  const { hidden } = useSceneVisibilityStore.getState()
  if (ids.every((id) => hidden.has(id) === hide)) return
  const next = new Set(hidden)
  for (const id of ids) {
    if (hide) next.add(id)
    else next.delete(id)
  }
  useSceneVisibilityStore.setState({ hidden: next.size === 0 ? EMPTY : next })
}

// Shift+H: 고립 보기 중이면 나가고, 아니면 선택(과 하위)만 보인다. 선택이 없으면 아무것도 하지 않는다.
export function toggleIsolation(objects: SceneObjects, ids: readonly string[]): boolean {
  if (useSceneVisibilityStore.getState().isolated) {
    exitIsolation()
    return true
  }
  const existing = ids.filter((id) => objects[id])
  if (existing.length === 0) return false
  useSceneVisibilityStore.setState({ isolated: [...existing] })
  return true
}

export function exitIsolation(): void {
  if (useSceneVisibilityStore.getState().isolated)
    useSceneVisibilityStore.setState({ isolated: null })
}
