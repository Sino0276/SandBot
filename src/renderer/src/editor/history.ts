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
// 프로젝트를 여는 중: 기록하지 않고 실행 취소도 막는다(여는 도중 되돌리면 이전 프로젝트 씬이 새 프로젝트에 들어간다)
let suspended = false

function current(): SceneObjects {
  return useSceneStore.getState().objects
}

function syncFlags(): void {
  const canUndo = !suspended && past.length > 0
  const canRedo = !suspended && future.length > 0
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
    if (applying || suspended || state.objects === previous.objects) return
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
  // 되돌린 씬에 없는 오브젝트만 선택·이름 바꾸기에서 뺀다(남은 선택은 그대로 둔다)
  useEditorStore.getState().pruneSelection((id) => !!objects[id])
  syncFlags()
}

// 핸들 드래그처럼 묶는 중인 변경이 있는지(이때는 실행 취소·삭제·도구 전환 단축키를 쓰지 않는다)
export function isChangeOpen(): boolean {
  return changeDepth > 0
}

export function suspendHistory(): void {
  suspended = true
  syncFlags()
}

export function resumeHistory(): void {
  suspended = false
  syncFlags()
}

// 기록 전체(현재 씬과 모든 스냅샷)에 같은 수정을 적용한다. 실행 취소 단계가 아니라 사실 자체가 바뀐 경우에 쓴다.
// 예: CAD 파일 다시 찾기. 형상은 파일에서 다시 읽어 바뀌므로, 경로만 되돌리면 화면과 저장 내용이 어긋난다.
export function rewriteHistory(update: (objects: SceneObjects) => SceneObjects): void {
  past = past.map(update)
  future = future.map(update)
  if (changeStart) changeStart = update(changeStart)
  const next = update(current())
  if (next === current()) return
  applying = true
  try {
    useSceneStore.setState({ objects: next })
  } finally {
    applying = false
  }
}

export function undo(): boolean {
  if (suspended) return false
  closeOpenChange()
  const previous = past.pop()
  if (!previous) return false
  future.push(current())
  apply(previous)
  return true
}

export function redo(): boolean {
  if (suspended) return false
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
