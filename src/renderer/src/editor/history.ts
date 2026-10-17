import { create } from 'zustand'
import type { TunableEdits } from '../java/tunableEdits'
import { disposeGeometry, geometryIds } from '../scene/geometryRegistry'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { useEditorStore } from './editorStore'

// 실행 취소·다시 실행. 씬 문서(sceneStore의 objects와 저장하지 않은 튜닝 값 tunables)는 바꿀 때마다 새 객체를 만드는
// 불변 데이터라서 바뀌기 전 문서를 그대로 스냅샷으로 쌓는다(바뀌지 않은 오브젝트와, 튜닝 값만 바꾼 단계의 objects는
// 스냅샷끼리 공유된다). 하나의 기록이라 씬 편집과 튜닝 값 편집이 고친 순서대로 되돌아간다.
// 선택·보기 기준 같은 편집기 상태는 기록하지 않는다.

const LIMIT = 200

type HistoryFlags = { canUndo: boolean; canRedo: boolean }

// 툴바 버튼의 활성 상태
export const useHistoryStore = create<HistoryFlags>()(() => ({ canUndo: false, canRedo: false }))

type HistoryDoc = { objects: SceneObjects; tunables: TunableEdits }

let past: HistoryDoc[] = []
let future: HistoryDoc[] = []
// 실행 취소로 씬을 바꾸는 중(이 변경은 기록하지 않는다)
let applying = false
// 핸들 드래그처럼 여러 번 바뀌는 조작을 한 단계로 묶는다
let changeDepth = 0
let changeStart: HistoryDoc | null = null
let initialized = false
// 프로젝트를 여는 중: 기록하지 않고 실행 취소도 막는다(여는 도중 되돌리면 이전 프로젝트 씬이 새 프로젝트에 들어간다)
let suspended = false

function current(): HistoryDoc {
  const { objects, tunables } = useSceneStore.getState()
  return { objects, tunables }
}

function sameDoc(a: HistoryDoc, b: HistoryDoc): boolean {
  return a.objects === b.objects && a.tunables === b.tunables
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
  // 튜닝 값만 바꾼 단계는 objects를 공유하므로 같은 objects는 한 번만 본다
  const seen = new Set<SceneObjects>()
  for (const snapshot of [current(), ...past, ...future]) {
    if (seen.has(snapshot.objects)) continue
    seen.add(snapshot.objects)
    for (const object of Object.values(snapshot.objects)) {
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

function record(snapshot: HistoryDoc): void {
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
    if (applying || suspended) return
    if (state.objects === previous.objects && state.tunables === previous.tunables) return
    const before: HistoryDoc = { objects: previous.objects, tunables: previous.tunables }
    if (changeDepth > 0) {
      changeStart ??= before
      return
    }
    record(before)
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
  if (start && !sameDoc(start, current())) record(start)
}

// 끝나지 않은 묶음이 있으면(마우스를 놓친 드래그 등) 닫는다
function closeOpenChange(): void {
  if (changeDepth === 0) return
  changeDepth = 1
  endChange()
}

// 기록하지 않는 문서 변경(실행 취소, 기록 전체 고치기)
function setUnrecorded(patch: Partial<HistoryDoc>): void {
  applying = true
  try {
    useSceneStore.setState(patch)
  } finally {
    applying = false
  }
}

function apply(doc: HistoryDoc): void {
  setUnrecorded({ objects: doc.objects, tunables: doc.tunables })
  // 되돌린 씬에 없는 오브젝트만 선택·이름 바꾸기에서 뺀다(남은 선택은 그대로 둔다)
  const { objects } = doc
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

// 같은 입력에는 같은 결과를 돌려주는 update. 여러 스냅샷이 공유하는 값(튜닝 값만 바꾼 단계의 objects 등)은
// 한 번만 고치고 결과도 공유한다(메모리 사용이 그대로다).
function memoized<T extends object>(update: (value: T) => T): (value: T) => T {
  const memo = new Map<T, T>()
  return (value) => {
    let next = memo.get(value)
    if (next === undefined) {
      next = update(value)
      memo.set(value, next)
    }
    return next
  }
}

// 기록 전체(현재 문서, 모든 스냅샷, 열린 묶음의 시작)의 한 부분에 같은 수정을 적용한다. 기록하지 않는다.
function rewriteAll<K extends keyof HistoryDoc>(
  key: K,
  update: (value: HistoryDoc[K]) => HistoryDoc[K]
): void {
  const map = memoized(update)
  const mapDoc = (doc: HistoryDoc): HistoryDoc => {
    const value = map(doc[key])
    return value === doc[key] ? doc : { ...doc, [key]: value }
  }
  past = past.map(mapDoc)
  future = future.map(mapDoc)
  if (changeStart) changeStart = mapDoc(changeStart)
  const now = useSceneStore.getState()[key]
  const next = map(now)
  if (next !== now) setUnrecorded({ [key]: next } as Partial<HistoryDoc>)
}

// 기록 전체(현재 씬과 모든 스냅샷)에 같은 수정을 적용한다. 실행 취소 단계가 아니라 사실 자체가 바뀐 경우에 쓴다.
// 예: CAD 파일 다시 찾기. 형상은 파일에서 다시 읽어 바뀌므로, 경로만 되돌리면 화면과 저장 내용이 어긋난다.
export function rewriteHistory(update: (objects: SceneObjects) => SceneObjects): void {
  rewriteAll('objects', update)
}

// 튜닝 값 기록 전체에 같은 수정을 적용한다(기록하지 않음). 저장해 Java 파일에 쓴 뒤 모든 스냅샷을 새 디스크 값
// 기준으로 옮기는 데 쓴다(java/tunableEdits.ts rebaseAfterWrite).
export function rewriteTunableHistory(update: (tunables: TunableEdits) => TunableEdits): void {
  rewriteAll('tunables', update)
}

// 지금 문서의 튜닝 값만 바꾼다(기록하지 않음). 저장 때 충돌한 편집을 지금 문서에서 뺄 때 쓴다(파일 값을 따름).
export function replaceCurrentTunables(next: TunableEdits): void {
  if (useSceneStore.getState().tunables !== next) setUnrecorded({ tunables: next })
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
