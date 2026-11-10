import { useSyncExternalStore } from 'react'
import { objectHullPoints } from '../../scene/meshHull'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { robotOutline } from '../../play/worldSpec'
import {
  buildCollisionModel,
  createCollisionModelCache,
  type CollisionModel,
  type CollisionModelCache
} from '../../play/worldColliders'
import { jointBodyFrames, type JointBodyFrames } from '../../play/worldJoints'
import { isChangeOpen, onChangeClosed } from '../history'

// 인스펙터(Collider 카드·몸체 충돌 구역)와 씬 뷰 Collider 기즈모가 같이 쓰는 충돌 모델(spec-5 §5.4 기억, F3·C-M7). 씬 문서·형상
// revision마다 로봇 하나에 한 번 계산하고, 몸체 결과와 앞 계산 짝은 로봇마다 기억(play/worldColliders.ts CollisionModelCache)으로
// 다시 쓴다: 이름 바꾸기·하드웨어 속성 같은 충돌 무관 편집이나 다른 몸체 편집 뒤에도 바뀌지 않은 몸체의 결과는 같은 객체다.
//
// 핸들 드래그처럼 묶는 중인 변경(history의 isChangeOpen) 동안에는 문서가 프레임마다 바뀌므로 다시 계산하지 않고 마지막 결과를
// 쓴다. 묶음이 닫히면(onChangeClosed) 구독자를 다시 그려 마지막 문서로 한 번 계산한다(질량 모델 useMassModel과 같은 방식).
// 결과는 문서 밖 값이라 실행 취소·dirty와 관계없다. INIT의 세계 설명(play/playActions.ts)은 기억 없이 같은 함수로 새로 계산한다
// (결정적이라 같은 값이다).

type Entry = {
  objects: SceneObjects
  revision: number
  model: CollisionModel
  joints: JointBodyFrames
  cache: CollisionModelCache
}

// 로봇 id → 마지막 계산
const entries = new Map<string, Entry>()
// 기억이 끝없이 늘지 않게(로봇 수만큼이면 충분하다) [가정: 한 씬의 로봇은 이보다 적다]
const ENTRY_LIMIT = 16

let refreshVersion = 0
let waitingForClose: (() => void) | null = null
const listeners = new Set<() => void>()

function refreshWhenChangeCloses(): void {
  if (waitingForClose) return
  waitingForClose = onChangeClosed(() => {
    waitingForClose?.()
    waitingForClose = null
    refreshVersion++
    for (const listener of [...listeners]) listener()
  })
}

function subscribeRefresh(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const refreshSnapshot = (): number => refreshVersion

// 로봇의 충돌 모델과 그 몸체 나누기(같은 문서). 로봇이 아니면 null
export function collisionModelEntry(
  objects: SceneObjects,
  revision: number,
  robotId: string
): { model: CollisionModel; joints: JointBodyFrames } | null {
  if (objects[robotId]?.kind !== 'robot') return null
  const entry = entries.get(robotId)
  if (entry && entry.objects === objects && entry.revision === revision) return entry
  if (entry && isChangeOpen()) {
    refreshWhenChangeCloses()
    return entry
  }
  const joints = jointBodyFrames(objects, robotId)
  const cache = entry?.cache ?? createCollisionModelCache()
  const model = buildCollisionModel({
    objects,
    robotId,
    joints,
    shapes: (id) => objectHullPoints(objects, id),
    outline: robotOutline(objects, robotId),
    cache
  })
  if (entries.size >= ENTRY_LIMIT && !entries.has(robotId)) entries.clear()
  const next: Entry = { objects, revision, model, joints, cache }
  entries.set(robotId, next)
  return next
}

// = collisionModelEntry(…)?.model
export function collisionModelFor(
  objects: SceneObjects,
  revision: number,
  robotId: string
): CollisionModel | null {
  return collisionModelEntry(objects, revision, robotId)?.model ?? null
}

// 기억을 비운다(시험)
export function clearCollisionModels(): void {
  entries.clear()
}

// 드래그 중 미룬 계산을 새로 고칠 때 다시 그리게 구독한다(값은 collisionModelEntry가 준다, 씬 뷰 기즈모)
export function useCollisionModelRefresh(): number {
  return useSyncExternalStore(subscribeRefresh, refreshSnapshot, refreshSnapshot)
}

// 지금 문서·형상 revision의 충돌 모델(로봇이 아니면 null). 드래그 중 미룬 계산을 새로 고칠 때 다시 그린다
export function useCollisionModel(
  robotId: string | null
): { model: CollisionModel; joints: JointBodyFrames } | null {
  const objects = useSceneStore((state) => state.objects)
  const revision = useSceneStore((state) => state.geometryRevision)
  useSyncExternalStore(subscribeRefresh, refreshSnapshot, refreshSnapshot)
  return robotId ? collisionModelEntry(objects, revision, robotId) : null
}
