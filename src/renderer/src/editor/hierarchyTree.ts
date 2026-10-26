import { create } from 'zustand'
import { ancestorIds, childrenInDocument, type SceneObjects } from '../scene/model'

// 하이어라키 트리의 보이는 행·펼침 상태·키보드 이동(순수 함수와 작은 스토어). Vitest에 DOM이 없어 패널에서 뺐다.

// 사용자가 펼치거나 접지 않은 행은 이 깊이 미만만 펼친다(로봇과 그 바로 아래)
const DEFAULT_OPEN_DEPTH = 2

export type TreeRow = {
  id: string
  depth: number
  parentId: string | null
  hasChildren: boolean
  open: boolean
  // 형제 중 순번(1부터)과 형제 수(aria-posinset·aria-setsize)
  posInSet: number
  setSize: number
}

type OpenOverrides = Readonly<Record<string, boolean>>

export function isRowOpen(overrides: OpenOverrides, id: string, depth: number): boolean {
  return overrides[id] ?? depth < DEFAULT_OPEN_DEPTH
}

// 지금 보이는 행(펼친 행의 자식만), 화면 순서. 순환이 있어도 끝난다.
export function visibleRows(objects: SceneObjects, overrides: OpenOverrides): TreeRow[] {
  const rows: TreeRow[] = []
  const visited = new Set<string>()
  const walk = (parentId: string | null, depth: number): void => {
    const siblings = childrenInDocument(objects, parentId)
    siblings.forEach((object, index) => {
      if (visited.has(object.id)) return
      visited.add(object.id)
      const hasChildren = childrenInDocument(objects, object.id).length > 0
      const open = hasChildren && isRowOpen(overrides, object.id, depth)
      rows.push({
        id: object.id,
        depth,
        parentId,
        hasChildren,
        open,
        posInSet: index + 1,
        setSize: siblings.length
      })
      if (open) walk(object.id, depth + 1)
    })
  }
  walk(null, 0)
  return rows
}

// 검색어 비교용 글자(앞뒤 공백 없이, 대소문자·NFC 무시)
function searchKey(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase().trim()
}

// 검색어가 오브젝트에 맞는가: 이름이나 붙인 하드웨어의 장치 이름(구성 이름)에 들어 있다. 구성 이름은 FTC에서
// 코드로 장치를 찾는 이름이라 함께 찾는다(Unity는 이름만 찾는다).
function matchesSearch(object: SceneObjects[string], key: string): boolean {
  if (searchKey(object.name).includes(key)) return true
  return (object.components ?? []).some((component) => searchKey(component.name).includes(key))
}

// 검색 결과 행(Unity처럼 계층 없이 평평하게, 문서 순서). 검색어가 비면 null.
export function searchRows(objects: SceneObjects, query: string): TreeRow[] | null {
  const key = searchKey(query)
  if (!key) return null
  const ids: string[] = []
  const visited = new Set<string>()
  const walk = (parentId: string | null): void => {
    for (const object of childrenInDocument(objects, parentId)) {
      if (visited.has(object.id)) continue
      visited.add(object.id)
      if (matchesSearch(object, key)) ids.push(object.id)
      walk(object.id)
    }
  }
  walk(null)
  return ids.map((id, index) => ({
    id,
    depth: 0,
    parentId: null,
    hasChildren: false,
    open: false,
    posInSet: index + 1,
    setSize: ids.length
  }))
}

// 하이어라키 키보드(Unity TreeView와 같음): 위/아래 선택 이동(Shift는 범위), Home/End,
// 오른쪽은 펼치기(펼쳐 있으면 첫 자식으로), 왼쪽은 접기(접혀 있거나 자식이 없으면 부모로)
export type TreeKeyAction =
  { type: 'select'; id: string; extend: boolean } | { type: 'setOpen'; id: string; open: boolean }

export function treeKeyAction(
  rows: readonly TreeRow[],
  currentId: string | null,
  key: string,
  shiftKey: boolean
): TreeKeyAction | null {
  if (rows.length === 0) return null
  const index = currentId === null ? -1 : rows.findIndex((row) => row.id === currentId)
  const select = (row: TreeRow | undefined, extend = shiftKey): TreeKeyAction | null =>
    row ? { type: 'select', id: row.id, extend } : null
  switch (key) {
    case 'ArrowDown':
      return select(index < 0 ? rows[0] : rows[index + 1])
    case 'ArrowUp':
      return select(index < 0 ? rows[rows.length - 1] : rows[index - 1])
    case 'Home':
      return select(rows[0])
    case 'End':
      return select(rows[rows.length - 1])
  }
  if (index < 0) return null
  const row = rows[index]
  if (key === 'ArrowRight') {
    if (!row.hasChildren) return null
    if (!row.open) return { type: 'setOpen', id: row.id, open: true }
    return select(rows[index + 1], false)
  }
  if (key === 'ArrowLeft') {
    if (row.open) return { type: 'setOpen', id: row.id, open: false }
    return select(
      rows.find((candidate) => candidate.id === row.parentId),
      false
    )
  }
  return null
}

// 선택 id 집합. 큰 CAD(행 수천 개)에서 행마다 선택 배열을 훑지 않게 선택 배열마다 한 번 만든다
// (editorStore는 선택이 바뀔 때만 새 배열을 만든다).
const selectionSets = new WeakMap<readonly string[], ReadonlySet<string>>()

export function selectionSet(ids: readonly string[]): ReadonlySet<string> {
  let set = selectionSets.get(ids)
  if (!set) {
    set = new Set(ids)
    selectionSets.set(ids, set)
  }
  return set
}

// 펼침 상태와 검색어. 씬 문서가 아니라 보기 상태라 실행 취소·저장에 들어가지 않는다.
type HierarchyViewState = {
  // 사용자가 직접 접거나 편 행(나머지는 DEFAULT_OPEN_DEPTH로 정한다)
  overrides: OpenOverrides
  setOpen: (ids: readonly string[], open: boolean) => void
  // 하이어라키 검색어(비면 트리, 있으면 결과 목록)
  query: string
  setQuery: (query: string) => void
}

export const useHierarchyViewStore = create<HierarchyViewState>()((set) => ({
  overrides: {},
  query: '',
  setQuery: (query) => set({ query }),
  setOpen: (ids, open) =>
    set((state) => {
      if (ids.every((id) => state.overrides[id] === open)) return state
      const overrides = { ...state.overrides }
      for (const id of ids) overrides[id] = open
      return { overrides }
    })
}))

// ids가 보이도록 상위 행을 펼친다(씬 뷰에서 선택했을 때, 새 그룹, 옮긴 뒤. Unity도 선택을 하이어라키에 펼쳐 보인다).
export function revealObjects(objects: SceneObjects, ids: readonly string[]): void {
  const ancestors = new Set<string>()
  for (const id of ids) {
    if (objects[id]) for (const ancestor of ancestorIds(objects, id)) ancestors.add(ancestor)
  }
  if (ancestors.size > 0) useHierarchyViewStore.getState().setOpen([...ancestors], true)
}
