import { Matrix4 } from 'three'
import { robotHardwareSettings } from '../hardware/components'
import {
  ancestorIds,
  childrenInDocument,
  constrainTransform,
  findRobotId,
  isCodeGroup,
  isInSubtree,
  matrixToTransform,
  subtreeIds,
  worldMatrix,
  type SceneObject,
  type SceneObjects,
  type Transform,
  type Vec3
} from './model'

// 하이어라키 편집(부모 바꾸기·순서·Create Empty·이름 바꾸기·삭제)의 순수 연산. 입력 문서는 고치지 않고 새 objects를 만든다.
// 바뀐 것이 없거나 할 수 없는 편집이면 받은 objects를 그대로 돌려준다(실행 취소 기록에 빈 단계가 생기지 않게).
// 형제 순서는 objects의 키 순서다. 키를 다시 넣을 때도 그 순서를 지킨다.

export const DEFAULT_GROUP_NAME = 'Group'

// 행렬 계산에서 남는 이 값보다 작은 수는 0으로 맞춘다(1e-17 같은 값이 인스펙터와 프로젝트 파일에 남지 않게)
const SNAP_EPSILON = 1e-12

const snap = (value: number): number => (Math.abs(value) < SNAP_EPSILON ? 0 : value)

// 새 배열에 담는다. 불러온 CAD 노드들은 회전 배열 하나를 함께 쓰므로 받은 배열을 고치면 안 된다.
function snapTransform(transform: Transform): Transform {
  return {
    position: transform.position.map(snap) as Vec3,
    rotation: transform.rotation.map(snap) as Vec3
  }
}

function identityTransform(): Transform {
  return { position: [0, 0, 0], rotation: [0, 0, 0] }
}

// 필드 기준 행렬을 parentId 아래의 로컬 변환으로 바꾼다
function localUnder(objects: SceneObjects, parentId: string | null, world: Matrix4): Transform {
  const local = parentId ? worldMatrix(objects, parentId).invert().multiply(world) : world
  return snapTransform(matrixToTransform(local))
}

// cadOrigin이 없을 때 부모 쪽에서 물려받는 CAD 출처. 위로 올라가며 처음 만나는 CAD 루트나 cadOrigin을 가진 노드에서 가져온다.
// 그룹은 출처가 없으므로 건너뛰고, 로봇에 닿으면 출처가 없다.
function inheritedCadOrigin(objects: SceneObjects, parentId: string | null): string | null {
  const visited = new Set<string>()
  let current = parentId ? objects[parentId] : undefined
  while (current && !visited.has(current.id)) {
    if (current.cad) return current.id
    if (current.cadOrigin && !isCodeGroup(current)) return current.cadOrigin
    if (current.kind === 'robot') return null
    visited.add(current.id)
    current = current.parentId ? objects[current.parentId] : undefined
  }
  return null
}

// 오브젝트가 온 CAD 루트의 id. CAD 루트는 자기 자신, 그룹·로봇이나 CAD에서 오지 않은 오브젝트는 null.
// 자신의 cadOrigin(CAD 밖으로 옮긴 노드), 없으면 부모 쪽에서 물려받은 출처다.
export function cadOriginOf(objects: SceneObjects, id: string): string | null {
  const object = objects[id]
  if (!object) return null
  if (object.cad) return id
  if (isCodeGroup(object) || object.kind === 'robot') return null
  const origin = object.cadOrigin ?? inheritedCadOrigin(objects, object.parentId)
  return origin && objects[origin]?.cad ? origin : null
}

// 선택에서 다른 선택의 하위인 것과 중복·없는 id를 뺀다(받은 순서 유지). 부모를 옮기면 하위는 함께 옮겨진다.
export function selectionRoots(objects: SceneObjects, ids: readonly string[]): string[] {
  const selected = new Set(ids.filter((id) => objects[id]))
  return [...selected].filter((id) => !ancestorIds(objects, id).some((a) => selected.has(a)))
}

// 옮길 수 없는 이유
export type MoveRejection =
  // 옮길 오브젝트가 없다
  | 'empty'
  // 없는 오브젝트·부모·기준 형제
  | 'missing'
  // 로봇은 최상위에서 순서만 바꾼다
  | 'robot'
  // CAD 루트는 지금 부모 안에서 순서만 바꾼다(CAD 루트의 transform이 곧 CAD 정렬이다)
  | 'cadRoot'
  // 소속 로봇이 바뀐다(형상과 정렬이 원래 로봇의 CAD에 묶여 있다)
  | 'otherRobot'
  // 자기 자신이나 하위 아래로
  | 'descendant'
  // beforeId가 새 부모의 자식이 아니거나 옮기는 오브젝트다
  | 'before'

// ids를 parentId의 자식으로(beforeId 앞, 없으면 마지막) 옮길 수 없는 이유. 옮길 수 있으면 null.
// 하나라도 옮길 수 없으면 전체를 거부한다.
export function moveRejection(
  objects: SceneObjects,
  ids: readonly string[],
  parentId: string | null,
  beforeId: string | null = null
): MoveRejection | null {
  if (ids.some((id) => !objects[id])) return 'missing'
  const roots = selectionRoots(objects, ids)
  if (roots.length === 0) return 'empty'
  if (parentId !== null && !objects[parentId]) return 'missing'
  if (beforeId !== null) {
    if (!objects[beforeId]) return 'missing'
    if (objects[beforeId].parentId !== parentId || ids.includes(beforeId)) return 'before'
  }
  const parentRobot = parentId === null ? null : findRobotId(objects, parentId)
  for (const id of roots) {
    const object = objects[id]
    if (object.kind === 'robot') {
      if (parentId !== null) return 'robot'
      continue
    }
    if (object.cad && parentId !== object.parentId) return 'cadRoot'
    if (parentId !== null && isInSubtree(objects, parentId, id)) return 'descendant'
    if (parentRobot !== findRobotId(objects, id)) return 'otherRobot'
  }
  return null
}

export function canMoveObjects(
  objects: SceneObjects,
  ids: readonly string[],
  parentId: string | null,
  beforeId: string | null = null
): boolean {
  return moveRejection(objects, ids, parentId, beforeId) === null
}

// 키 순서를 다시 짠 새 objects. moved(순서대로)를 원래 자리에서 빼고 beforeId 앞(없으면 끝)에 넣는다.
function reinsert(
  objects: SceneObjects,
  moved: readonly SceneObject[],
  beforeId: string | null
): SceneObjects {
  const movedIds = new Set(moved.map((object) => object.id))
  const result: SceneObjects = {}
  for (const [id, object] of Object.entries(objects)) {
    if (id === beforeId) for (const m of moved) result[m.id] = m
    if (!movedIds.has(id)) result[id] = object
  }
  if (beforeId === null) for (const m of moved) result[m.id] = m
  return result
}

// 옮긴 결과가 원래 문서와 같은지: 모든 오브젝트가 그대로이고 새 부모의 자식 순서도 같다(전체 키 순서는 달라도 된다).
// 부모가 바뀌었으면 그 오브젝트가 새 객체라 다르다.
function unchangedMove(
  before: SceneObjects,
  after: SceneObjects,
  parentId: string | null
): boolean {
  const ids = Object.keys(after)
  if (ids.length !== Object.keys(before).length || ids.some((id) => before[id] !== after[id]))
    return false
  const previous = childrenInDocument(before, parentId)
  const next = childrenInDocument(after, parentId)
  return previous.length === next.length && previous.every((object, i) => next[i] === object)
}

// cadOrigin을 바꾼 새 오브젝트(없애면 키를 지운다)
function withCadOrigin(object: SceneObject, cadOrigin: string | undefined): SceneObject {
  if (object.cadOrigin === cadOrigin) return object
  const next = { ...object }
  if (cadOrigin) next.cadOrigin = cadOrigin
  else delete next.cadOrigin
  return next
}

// 부모를 바꾼 subtree들의 cadOrigin을 맞춘다(after를 직접 고친다. 호출한 쪽이 방금 만든 문서에만 쓴다).
// 출처는 옮기기 전 문서(before)에서 구하고, 옮긴 뒤 부모 쪽에서 같은 출처를 물려받으면 자신의 값은 지운다
// (CAD 루트 안으로 돌아온 경우 등). 물려받는 출처와 다를 때만(CAD 밖으로 나간 경우 등) 자신에게 둔다.
// 그룹·로봇에는 두지 않는다. 그룹은 CAD 루트를 지워도 남고, 정렬이 바뀌어도 움직이지 않는다.
function normalizeCadOrigins(
  before: SceneObjects,
  after: SceneObjects,
  roots: readonly string[]
): void {
  for (const root of roots) {
    // 위에서 아래 순서라 부모의 값을 먼저 맞춘다
    for (const id of subtreeIds(before, root)) {
      const object = after[id]
      if (!object || object.cad) continue
      let desired: string | undefined
      if (!isCodeGroup(object) && object.kind !== 'robot') {
        const origin = cadOriginOf(before, id)
        if (origin && origin !== inheritedCadOrigin(after, object.parentId)) desired = origin
      }
      after[id] = withCadOrigin(object, desired)
    }
  }
}

// ids를 parentId 아래로 옮긴다(beforeId 앞, 없으면 마지막. ids의 순서대로). 월드 자세는 그대로 둔다(새 로컬 = P⁻¹·W).
// 옮길 수 없으면(moveRejection) 받은 objects를 그대로 돌려준다.
export function moveObjects(
  objects: SceneObjects,
  ids: readonly string[],
  parentId: string | null,
  beforeId: string | null = null
): SceneObjects {
  if (moveRejection(objects, ids, parentId, beforeId)) return objects
  const roots = selectionRoots(objects, ids)
  const reparented: string[] = []
  const moved = roots.map((id) => {
    const object = objects[id]
    // 부모가 같으면 순서만 바뀐다. 변환을 다시 계산하지 않아 값이 그대로 남는다.
    if (object.parentId === parentId) return object
    reparented.push(id)
    const next = { ...object, parentId }
    const local = localUnder(objects, parentId, worldMatrix(objects, id))
    return { ...next, transform: constrainTransform(next, local) }
  })
  const result = reinsert(objects, moved, beforeId)
  normalizeCadOrigins(objects, result, reparented)
  return unchangedMove(objects, result, parentId) ? objects : result
}

export type NewGroup = {
  id: string
  parentId: string | null
  name: string
  // 이 오브젝트 바로 뒤에 넣는다. 없으면 마지막 형제가 된다.
  afterId?: string | null
}

// 빈 그룹(Unity의 Create Empty). 부모 원점에 놓인다(로컬 변환 0).
export function createGroup(objects: SceneObjects, group: NewGroup): SceneObjects {
  const { id, parentId, name, afterId = null } = group
  if (objects[id] || (parentId !== null && !objects[parentId])) return objects
  const object: SceneObject = { id, name, kind: 'group', parentId, transform: identityTransform() }
  if (afterId === null || !objects[afterId]) return { ...objects, [id]: object }
  const result: SceneObjects = {}
  for (const [key, value] of Object.entries(objects)) {
    result[key] = value
    if (key === afterId) result[id] = object
  }
  return result
}

// Create Empty Parent를 할 수 있는지. Unity처럼 같은 부모를 가진 오브젝트들만 묶는다.
// 로봇(최상위에만 있다)과 CAD 루트(부모를 바꾸지 않는다)는 묶을 수 없다(moveRejection과 같은 규칙).
export function canCreateEmptyParent(objects: SceneObjects, ids: readonly string[]): boolean {
  if (ids.length === 0 || ids.some((id) => !objects[id])) return false
  const parentId = objects[ids[0]].parentId
  return ids.every((id) => {
    const object = objects[id]
    return object.parentId === parentId && object.kind !== 'robot' && !object.cad
  })
}

// 선택을 새 그룹으로 묶는다(Unity의 Create Empty Parent). 그룹은 공통 부모의 원점(로컬 변환 0)에 놓이고,
// 형제 중 활성 오브젝트 자리(활성 오브젝트 바로 뒤)에 들어간다. 선택은 형제 순서대로 그 아래로 옮겨진다.
// 그룹의 월드 행렬이 부모와 같으므로 선택의 로컬 변환은 그대로 두면 월드 자세가 유지된다.
export function createEmptyParent(
  objects: SceneObjects,
  ids: readonly string[],
  activeId: string | null,
  groupId: string,
  name: string
): SceneObjects {
  if (!canCreateEmptyParent(objects, ids) || objects[groupId]) return objects
  const selected = new Set(ids)
  const parentId = objects[ids[0]].parentId
  const ordered = Object.keys(objects).filter((id) => selected.has(id))
  const anchor =
    activeId !== null && selected.has(activeId) ? activeId : ordered[ordered.length - 1]
  const group: SceneObject = {
    id: groupId,
    name,
    kind: 'group',
    parentId,
    transform: identityTransform()
  }
  const result: SceneObjects = {}
  for (const [id, object] of Object.entries(objects)) {
    if (!selected.has(id)) result[id] = object
    else if (id === anchor) {
      result[groupId] = group
      for (const child of ordered) result[child] = { ...objects[child], parentId: groupId }
    }
  }
  normalizeCadOrigins(objects, result, ordered)
  return result
}

// 이름 바꾸기. 앞뒤 공백을 자르고, 빈 이름이면 바꾸지 않는다.
export function renameObject(objects: SceneObjects, id: string, name: string): SceneObjects {
  const object = objects[id]
  const trimmed = name.trim()
  if (!object || !trimmed || trimmed === object.name) return objects
  return { ...objects, [id]: { ...object, name: trimmed } }
}

// CAD 루트 밖으로 옮겨 cadOrigin이 그 루트인 오브젝트(그 하위는 뺀다)
function directDependents(objects: SceneObjects, rootId: string): string[] {
  return Object.values(objects)
    .filter((object) => object.cadOrigin === rootId && !isInSubtree(objects, object.id, rootId))
    .map((object) => object.id)
}

// CAD 루트 밖으로 옮긴 그 CAD의 노드들과 그 하위. CAD 루트를 지우면 함께 지운다.
export function cadDependents(objects: SceneObjects, rootId: string): string[] {
  const ids = new Set<string>()
  for (const id of directDependents(objects, rootId))
    for (const sub of subtreeIds(objects, id)) ids.add(sub)
  return [...ids]
}

// ids를 지우면 함께 지워지는 모든 id: 각 subtree와, 지우는 범위 안 모든 CAD 루트의 dependents(와 그 안의 CAD 루트의 것도)
export function removalIds(objects: SceneObjects, ids: readonly string[]): string[] {
  const removed = new Set<string>()
  const cadRoots: string[] = []
  const add = (id: string): void => {
    for (const sub of subtreeIds(objects, id)) {
      if (removed.has(sub)) continue
      removed.add(sub)
      if (objects[sub].cad) cadRoots.push(sub)
    }
  }
  for (const id of ids) if (objects[id]) add(id)
  while (cadRoots.length > 0) {
    for (const dependent of directDependents(objects, cadRoots.pop()!)) add(dependent)
  }
  return [...removed]
}

// ids의 subtree 말고 더 지워지는 id(다른 그룹으로 옮긴 CAD 파트). 있으면 UI가 지우기 전에 확인한다.
export function extraRemovalIds(objects: SceneObjects, ids: readonly string[]): string[] {
  const plain = new Set(ids.filter((id) => objects[id]).flatMap((id) => subtreeIds(objects, id)))
  return removalIds(objects, ids).filter((id) => !plain.has(id))
}

// ids와 그 하위, CAD 루트를 지우면 그 dependents까지 지운다(형상 해제는 editor/history.ts)
export function removeObjects(objects: SceneObjects, ids: readonly string[]): SceneObjects {
  const removed = removalIds(objects, ids)
  if (removed.length === 0) return objects
  const result = { ...objects }
  for (const id of removed) delete result[id]
  return result
}

// CAD 루트의 월드 행렬이 before → after에서 바뀌었으면, 루트 밖으로 옮긴 그 CAD의 노드들도 같은 변화
// D = W_after(루트)·W_before(루트)⁻¹만큼 옮긴다(정렬 변경과 CAD 루트를 직접 옮긴 경우).
// CAD 루트의 transform은 CAD를 로봇에 놓는 방법이라, 옮겨 나간 파트도 원래 CAD 안 자리를 따라가야 한다.
// 다른 dependent의 하위인 것은 부모와 함께 움직이므로 다시 옮기지 않는다.
export function carryCadDependents(
  before: SceneObjects,
  after: SceneObjects,
  rootId: string
): SceneObjects {
  if (!before[rootId]?.cad || !after[rootId]?.cad) return after
  const previous = worldMatrix(before, rootId)
  const next = worldMatrix(after, rootId)
  if (previous.equals(next)) return after
  const delta = next.multiply(previous.invert())
  const dependents = new Set(directDependents(after, rootId))
  const carried = [...dependents].filter(
    (id) => !ancestorIds(after, id).some((ancestor) => dependents.has(ancestor))
  )
  if (carried.length === 0) return after
  const result = { ...after }
  for (const id of carried) {
    const object = after[id]
    const world = delta.clone().multiply(worldMatrix(after, id))
    result[id] = {
      ...object,
      transform: constrainTransform(object, localUnder(after, object.parentId, world))
    }
  }
  return result
}

// 이름 비교 키. 생성 코드의 클래스 이름(javaClassName)처럼 글자·숫자만 보고 대소문자를 무시한다
// ('Group (1)'과 'group1'은 같다).
function classNameKey(name: string): string {
  return name.replace(/[^\p{L}\p{Nd}\p{Nl}]+/gu, '').toLowerCase()
}

// 새 그룹의 기본 이름. Unity처럼 겹치면 'Group (1)', 'Group (2)'…를 붙인다.
// 그룹 이름은 생성 코드의 중첩 클래스가 되므로, 형제뿐 아니라 감싸는 그룹과 로봇 클래스와도 겹치지 않게 한다
// (Java는 중첩 클래스가 감싸는 클래스와 같은 이름이면 오류다). childIds는 새 그룹 아래로 들어갈 오브젝트
// (Create Empty Parent)로, 그 안의 그룹 이름과도 겹치지 않게 한다.
export function defaultGroupName(
  objects: SceneObjects,
  parentId: string | null,
  base: string = DEFAULT_GROUP_NAME,
  childIds: readonly string[] = []
): string {
  const taken = new Set<string>()
  const take = (name: string | undefined): void => {
    if (name) taken.add(classNameKey(name))
  }
  const takeGroup = (object: SceneObject | undefined): void => {
    if (!object || !isCodeGroup(object)) return
    take(object.name)
    take(object.codeClassName)
  }
  for (const sibling of childrenInDocument(objects, parentId)) take(sibling.name)
  for (const id of parentId === null ? [] : [parentId, ...ancestorIds(objects, parentId)]) {
    const object = objects[id]
    takeGroup(object)
    if (object?.kind === 'robot') take(robotHardwareSettings(objects, id).className)
  }
  for (const id of childIds) {
    if (objects[id]) for (const sub of subtreeIds(objects, id)) takeGroup(objects[sub])
  }
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? base : `${base} (${n})`
    if (!taken.has(classNameKey(candidate))) return candidate
  }
}
