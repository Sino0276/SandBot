import { useSyncExternalStore } from 'react'
import { Box3, DoubleSide, Matrix4, Ray, Vector3 } from 'three'
import { rotationMatrix } from '../../../../shared/sim/seasons/fieldGeometry'
import type { SensorComponentType, SensorMountInRobot } from '../../hardware/mounting'
import { getGeometry } from '../../scene/geometryRegistry'
import { buildBvh } from '../../scene/meshBvh'
import { childrenInDocument, transformToMatrix, type SceneObjects } from '../../scene/model'
import { isChangeOpen, onChangeClosed } from '../history'
import { sensorOuterRays } from '../scene/sensorGizmoModel'

// 거리·컬러 센서의 자기 로봇 가림(4c, spec-4c §1.9). 편집 자세에서 축 광선과 바깥 광선(거리: 모선 8, 컬러: 발자국 6)을
// 그 로봇의 CAD 메시(숨김과 관계없음 — 숨김은 보기 상태)에 쏜다. 센서 오브젝트 자신과 그 하위의 형상(하우징)은 뺀다.
// 시뮬레이터에는 로봇 형상이 없으므로 값은 바꾸지 않고 경고만 한다(인스펙터 값 줄, 씬 뷰 점선, INIT Console
// worldSensorSelfHit).
//
// 넓은 단계는 메시의 로봇 좌표 경계 상자, 좁은 단계는 메시의 BVH(scene/meshBvh.ts, MeshBVH.raycastFirst)다. 쉬는 시간의
// 미리 만들기가 아직 그 메시에 닿지 않았으면 넓은 단계를 지난 메시만 그 자리에서 만든다(cadMeshRaycast와 같음). 건너뛰면
// 빈 결과가 selfHitFor 기억에 남고, BVH가 다 만들어져도 문서·geometryRevision이 그대로라 다시 계산하지 않기 때문이다
// (INIT의 Console 경고와 인스펙터·기즈모가 달라진다). 아직 등록되지 않은(읽는 중) 형상은 건너뛰고, 등록하면
// geometryRevision이 바뀌어 다시 계산한다.

// axis: 축 광선이 reach보다 가까이에서 그 파트에 맞음(distance m, 하우징 앞면부터, 가장 가까운 파트). partial: 바깥 광선만 맞음.
export type SelfHit = { kind: 'axis'; partId: string; distance: number } | { kind: 'partial' }

// 광선 원점은 하우징 앞면에서 이만큼 앞이다(m) [가정: 하우징 앞면이 자기 형상 경계 상자 위라 그 면이나 바로 옆 파트를
// 원점에서 맞지 않게. 1 mm는 FTC 파트 틈보다 작다]
export const SELF_HIT_ORIGIN_OFFSET = 0.001

type MeshEntry = {
  id: string
  geometryId: string
  // 로봇 좌표 → 메시 로컬
  toLocal: Matrix4
  // 메시 로컬 → 로봇 좌표(넓은 단계의 로봇 좌표 상자를 만들 때만)
  toRobot: Matrix4
}

// 씬 문서·로봇마다 한 번: 로봇 하위의 형상 오브젝트와 로봇 좌표 행렬(부모 사슬을 한 번만 내려가며 곱한다)
const meshIndex = new WeakMap<SceneObjects, Map<string, MeshEntry[]>>()

function robotMeshes(objects: SceneObjects, robotId: string): MeshEntry[] {
  let byRobot = meshIndex.get(objects)
  if (!byRobot) meshIndex.set(objects, (byRobot = new Map()))
  let entries = byRobot.get(robotId)
  if (entries) return entries
  entries = []
  const walk = (parentId: string, parentMatrix: Matrix4): void => {
    for (const child of childrenInDocument(objects, parentId)) {
      const matrix = parentMatrix.clone().multiply(transformToMatrix(child.transform))
      if (child.visual?.type === 'mesh')
        entries!.push({
          id: child.id,
          geometryId: child.visual.geometryId,
          toLocal: matrix.clone().invert(),
          toRobot: matrix
        })
      walk(child.id, matrix)
    }
  }
  walk(robotId, new Matrix4())
  byRobot.set(robotId, entries)
  return entries
}

// 형상 id → 로봇 좌표 경계 상자(문서마다, 형상이 바뀌면 다시)
const robotBoxes = new WeakMap<MeshEntry, { box: Box3; source: Box3 }>()

function robotBox(entry: MeshEntry, local: Box3): Box3 {
  const cached = robotBoxes.get(entry)
  if (cached && cached.source === local) return cached.box
  const box = local.clone().applyMatrix4(entry.toRobot)
  robotBoxes.set(entry, { box, source: local })
  return box
}

function subtreeSet(objects: SceneObjects, id: string): Set<string> {
  const ids = new Set<string>([id])
  const stack = [id]
  while (stack.length > 0)
    for (const child of childrenInDocument(objects, stack.pop()!)) {
      ids.add(child.id)
      stack.push(child.id)
    }
  return ids
}

const rayRobot = new Ray()
const rayLocal = new Ray()
const hitPoint = new Vector3()
const boxCenter = new Vector3()

// 넓은 단계의 앞 거르기: 상자의 외접 구가 광선 원뿔(꼭짓점 origin, 축 axis, 반각의 cos·sin)이나 reach 밖이면 어느 광선도
// 상자에 닿지 않는다(보수적: 구는 상자를 품는다). 메시 1761개에서 메시마다 광선 9개의 상자 검사를 한 번으로 줄인다.
function outsideCone(
  box: Box3,
  origin: Vector3,
  axis: Vector3,
  cos: number,
  sin: number,
  far: number
): boolean {
  box.getCenter(boxCenter).sub(origin)
  const radius =
    0.5 * Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
  const distance = boxCenter.length()
  if (distance - radius > far) return true
  const along = boxCenter.dot(axis)
  const across = Math.sqrt(Math.max(0, distance * distance - along * along))
  // 구 중심에서 원뿔 겉면까지의 거리(가장 가까운 점이 꼭짓점이면 꼭짓점까지의 거리)
  const gap = along * cos + across * sin >= 0 ? across * cos - along * sin : distance
  return gap > radius
}

// reachM: 편집 자세 값의 거리(없으면 거리 센서 1.2 m, 컬러 센서 6 in)
export function sensorSelfHit(
  objects: SceneObjects,
  robotId: string,
  sensorObjectId: string,
  mount: SensorMountInRobot,
  type: SensorComponentType,
  reachM: number
): SelfHit | null {
  if (!objects[robotId] || !objects[sensorObjectId] || !(reachM > 0)) return null
  const rotation = rotationMatrix(mount.rotation)
  const toRobot = (d: { x: number; y: number; z: number }): Vector3 =>
    new Vector3(
      rotation[0] * d.x + rotation[1] * d.y + rotation[2] * d.z,
      rotation[3] * d.x + rotation[4] * d.y + rotation[5] * d.z,
      rotation[6] * d.x + rotation[7] * d.y + rotation[8] * d.z
    )
  // 축 광선이 먼저, 바깥 광선이 그 뒤(센서 틀 → 로봇 좌표)
  const directions = [toRobot({ x: 1, y: 0, z: 0 }), ...sensorOuterRays(type).map(toRobot)]
  const axis = directions[0]
  const origin = new Vector3(mount.position.x, mount.position.y, mount.position.z).addScaledVector(
    axis,
    SELF_HIT_ORIGIN_OFFSET
  )
  const skip = subtreeSet(objects, sensorObjectId)
  const far = Math.max(0, reachM - SELF_HIT_ORIGIN_OFFSET)
  // 모든 광선을 품는 원뿔(꼭짓점 origin, 축 axis, 반각 = 바깥 광선의 축과의 각)
  const coneHalf = Math.max(0, ...directions.map((d) => Math.acos(Math.min(1, d.dot(axis)))))
  const coneCos = Math.cos(coneHalf)
  const coneSin = Math.sin(coneHalf)
  let axisHit: { partId: string; t: number } | null = null
  let outerHit = false
  for (const entry of robotMeshes(objects, robotId)) {
    if (skip.has(entry.id)) continue
    const geometry = getGeometry(entry.geometryId)
    if (!geometry) continue
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const local = geometry.boundingBox
    if (!local || local.isEmpty()) continue
    const box = robotBox(entry, local)
    if (outsideCone(box, origin, axis, coneCos, coneSin, far)) continue
    // 원점이 상자 안이면 광선은 상자 안에서 시작한다(three Ray.intersectBox는 그때 나가는 점을 준다)
    const inside = box.containsPoint(origin)
    for (let i = 0; i < directions.length; i++) {
      // 바깥 광선은 이미 하나 맞았으면 더 볼 필요가 없다(축은 가장 가까운 파트를 찾는다)
      if (i > 0 && (outerHit || axisHit)) break
      rayRobot.set(origin, directions[i])
      const boxHit = rayRobot.intersectBox(box, hitPoint)
      if (!boxHit) continue
      const limit = i === 0 && axisHit ? axisHit.t : far
      if (!inside && boxHit.distanceTo(origin) > limit) continue
      rayLocal.copy(rayRobot).applyMatrix4(entry.toLocal)
      const hit = buildBvh(geometry).raycastFirst(rayLocal, DoubleSide, 0, limit)
      if (!hit || !(hit.distance <= limit)) continue
      if (i === 0) axisHit = { partId: entry.id, t: hit.distance }
      else outerHit = true
    }
  }
  if (axisHit)
    return { kind: 'axis', partId: axisHit.partId, distance: axisHit.t + SELF_HIT_ORIGIN_OFFSET }
  return outerHit ? { kind: 'partial' } : null
}

// ---- 인스펙터·씬 뷰가 같이 쓰는 기억(질량 모델과 같은 방식, editor/mass/useMassModel.ts) ----
// 핸들 드래그(history의 묶음) 동안에는 다시 계산하지 않고 마지막 결과를 쓰고, 묶음이 닫히면 구독자를 다시 그려 한 번 계산한다
// (spec-4c §1.9 "자기 가림은 드래그가 끝날 때 한 번").

type CacheEntry = { objects: SceneObjects; revision: number; key: string; result: SelfHit | null }
const cache = new Map<string, CacheEntry>()
// 기억이 끝없이 늘지 않게(센서 컴포넌트 수만큼이면 충분하다) [가정: 한 씬의 거리·컬러 센서는 이보다 적다]
const CACHE_LIMIT = 256

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

// 드래그가 끝날 때 다시 그리게 구독한다(값은 selfHitFor가 준다)
export function useSelfHitRefresh(): number {
  return useSyncExternalStore(subscribeRefresh, refreshSnapshot, refreshSnapshot)
}

// componentId마다 마지막 결과. 문서·형상 revision·장착·종류·reach가 같으면 다시 쏘지 않는다.
export function selfHitFor(
  componentId: string,
  objects: SceneObjects,
  revision: number,
  robotId: string,
  sensorObjectId: string,
  mount: SensorMountInRobot,
  type: SensorComponentType,
  reachM: number
): SelfHit | null {
  const key = JSON.stringify([
    robotId,
    sensorObjectId,
    mount.position,
    mount.rotation,
    type,
    reachM
  ])
  const entry = cache.get(componentId)
  if (entry && entry.objects === objects && entry.revision === revision && entry.key === key)
    return entry.result
  if (entry && isChangeOpen()) {
    refreshWhenChangeCloses()
    return entry.result
  }
  const result = sensorSelfHit(objects, robotId, sensorObjectId, mount, type, reachM)
  if (cache.size >= CACHE_LIMIT && !cache.has(componentId)) cache.clear()
  cache.set(componentId, { objects, revision, key, result })
  return result
}
