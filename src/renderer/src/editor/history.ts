import { create } from 'zustand'
import { disposeGeometry, geometryIds } from '../scene/geometryRegistry'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { useEditorStore } from './editorStore'

// 실행 취소·다시 실행. 씬 문서(sceneStore.objects)는 바꿀 때마다 새 객체를 만드는 불변 데이터라서
// 바뀌기 전 objects를 그대로 스냅샷으로 쌓는다(바뀌지 않은 오브젝트는 스냅샷끼리 공유된다).
// 선택·보기 기준 같은 편집기 상태는 기록하지 않는다.

const LIMIT = 200

type HistoryFlags = { canUndo: boolean; canRedo: boolean }

// 툴바 버튼의 활성 상태
export const useHistoryStore = create<HistoryFlags>()(() => ({ canUndo: false, canRedo: false }))

let past: SceneObjects[] = []
let future: SceneObjects[] = []
// 실행 취소로 씬을 바꾸는 중(이 변경은 기록하지 않는다)
let applying = false
// 핸들 드래그처럼 여러 번 바뀌는 조작을 한 단계로 묶는다
let changeDepth = 0
let changeStart: SceneObjects | null = null
let initialized = false

function current(): SceneObjects {
  return useSceneStore.getState().objects
}

function syncFlags(): void {
  const canUndo = past.length > 0
  const canRedo = future.length > 0
  const flags = useHistoryStore.getState()
  if (flags.canUndo !== canUndo || flags.canRedo !== canRedo)
    useHistoryStore.setState({ canUndo, canRedo })
}

// 형상 해제. 지운 오브젝트도 기록에 남아 있으면 되살릴 수 있어야 하므로, 현재 씬과 모든 기록에서
// 쓰지 않게 된 형상만 해제한다. 한 번도 씬에 들어간 적 없는 형상(불러오는 중인 STEP)은 건드리지 않는다.
const referencedOnce = new Set<string>()

function referencedGeometry(): Set<string> {
  const ids = new Set<string>()
  for (const snapshot of [current(), ...past, ...future]) {
    for (const object of Object.values(snapshot)) {
      if (object.visual?.type === 'mesh') ids.add(object.visual.geometryId)
    }
  }
  return ids
}

export function collectGeometry(): void {
  const referenced = referencedGeometry()
  for (const id of referenced) referencedOnce.add(id)
  for (const id of geometryIds()) {
    if (referencedOnce.has(id) && !referenced.has(id)) {
      disposeGeometry(id)
      referencedOnce.delete(id)
    }
  }
}

let collectTimer: ReturnType<typeof setTimeout> | null = null

function scheduleCollect(): void {
  if (collectTimer) return
  collectTimer = setTimeout(() => {
    collectTimer = null
    collectGeometry()
  }, 1000)
}

function record(snapshot: SceneObjects): void {
  past.push(snapshot)
  if (past.length > LIMIT) past.splice(0, past.length - LIMIT)
  future = []
  syncFlags()
  scheduleCollect()
}

// 앱 시작 때 한 번. 이후 씬 문서의 모든 변경이 기록된다.
export function initHistory(): void {
  if (initialized) return
  initialized = true
  useSceneStore.subscribe((state, previous) => {
    if (applying || state.objects === previous.objects) return
    if (changeDepth > 0) {
      changeStart ??= previous.objects
      return
    }
    record(previous.objects)
  })
}

// 여러 번의 변경을 실행 취소 한 단계로 묶는다(begin/end 짝). 핸들 드래그에 쓴다.
export function beginChange(): void {
  changeDepth++
}

export function endChange(): void {
  if (changeDepth === 0) return
  changeDepth--
  if (changeDepth > 0) return
  const start = changeStart
  changeStart = null
  if (start && start !== current()) record(start)
}

// 끝나지 않은 묶음이 있으면(마우스를 놓친 드래그 등) 닫는다
function closeOpenChange(): void {
  if (changeDepth === 0) return
  changeDepth = 1
  endChange()
}

function apply(objects: SceneObjects): void {
  applying = true
  try {
    useSceneStore.setState({ objects })
  } finally {
    applying = false
  }
  const { selectedId, select } = useEditorStore.getState()
  if (selectedId && !objects[selectedId]) select(null)
  syncFlags()
}

export function undo(): boolean {
  closeOpenChange()
  const previous = past.pop()
  if (!previous) return false
  future.push(current())
  apply(previous)
  return true
}

export function redo(): boolean {
  closeOpenChange()
  const next = future.pop()
  if (!next) return false
  past.push(current())
  apply(next)
  return true
}

// 프로젝트를 열면 이전 씬의 기록은 버린다
export function clearHistory(): void {
  past = []
  future = []
  changeDepth = 0
  changeStart = null
  syncFlags()
  collectGeometry()
}
