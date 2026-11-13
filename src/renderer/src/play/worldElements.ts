import type { TFunction } from 'i18next'
import { Vector3, type Matrix4 } from 'three'
import {
  bodyShape,
  EDIT_OVERLAP_TOLERANCE,
  placeShape,
  shapeSeparation
} from '../../../shared/sim/collision3d'
import { resolveElementType } from '../../../shared/sim/elements/elementData'
import {
  autoPreloadSlots,
  elementSpawns,
  restBodyFrames,
  type PreloadFace
} from '../../../shared/sim/elements/spawn'
import type { FieldSpec } from '../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../shared/sim/seasons/seasons'
import type { Frame3 } from '../../../shared/sim/sensorFrame'
import {
  ELEMENT_GROUPS,
  MAX_PRELOADS,
  parseWorldSpec,
  type Pose2,
  type SimElementGroup,
  type SimPreloadSpec,
  type Vec3,
  type WorldSpec
} from '../../../shared/sim/worldSpec'
import { MAX_PRELOAD_EXTENT, preloadEnabled, robotPreloadIds } from '../scene/preload'
import type { SceneObjects } from '../scene/model'
import { robotObjectMatrix } from '../scene/robotMeshIndex'
import { wrapAngle } from '../scene/wheel'
import { plain } from './plain'
import type { PlayRunElements, PlayRunField } from './playStore'
import type { WorldColliderBody } from './worldColliders'
import { jointBodyFrames, type JointBodyFrames } from './worldJoints'
import { robotOutline, type WorldSpecResult } from './worldSpec'

// 세계 설명의 경기 요소(6a, spec-6a §3·§4): 실행에 생길 시즌 배치 묶음과 로봇의 프리로드 POLLEN. 순수 함수다.
//
// 프리로드 자리는 팀이 로봇 하위 오브젝트에 붙인 Preload Slot(SceneObject.preload, scene/preload.ts)이다. 자리 = 그 오브젝트의
// 로컬 틀(피벗·자기 축)의 center를 로봇 좌표로 옮긴 점(scene/robotMeshIndex.ts robotObjectMatrix, 충돌체 틀과 같은 곱셈 순서)이고,
// 세계 설명에는 그 점이 속한 몸체 틀(play/worldJoints.ts jointBodyFrames: 가장 가까운 자신·상위 관절, 관절 q = 0)로 넣는다(관절
// 하위 자리는 그 관절과 함께 움직인다). 하이어라키 순서로 켠 자리를 MAX_PRELOADS개까지 쓴다. 로봇에 Preload Slot이 하나도 없으면
// (끈 것도 없으면) 시뮬레이터와 같은 공유 함수 autoPreloadSlots(앞 → 뒤 → 왼쪽 → 오른쪽)가 정한 자리를 쓰고, 네 면이 다 막혔으면
// 프리로드 없이 실행한다(사용자 결정 11/13). 팀이 자리를 두었으면(모두 끄거나 쓸 수 없어도) 자동 배치를 하지 않는다: 팀이 정한
// 것을 바꾸지 않는다(Unity에서 컴포넌트를 끈 것처럼).
//
// 공의 물리 값·배치는 시즌 데이터(resolveSeason)에서 오고 렌더러는 묶음·자리만 보낸다(시뮬레이터가 렌더러 형상을 믿지 않는다).

// 세계 설명에서 빠지는 자리의 이유: 끔, 로봇 한도를 넘음(하이어라키 순서로 뒤), 공이 바닥 아래(1 mm 넘게), 몸체 틀 좌표가 세계
// 설명 한도(10 m) 밖, 로봇 밖(어느 로봇의 하위도 아님: 인스펙터만)
export type PreloadExclusion = 'disabled' | 'tooMany' | 'belowFloor' | 'outOfRange' | 'orphan'

// 쓰는 자리 하나(자리 순서 = 세계 설명 preloads 순서). 자동 배치는 objectId가 null이다
export type PreloadSlot = {
  objectId: string | null
  // 오브젝트 이름(Console 경고), 자동은 ''
  name: string
  // 몸체(−1 섀시 = 로봇 좌표, ≥ 0 세계 설명 관절 순번)
  body: number
  // 몸체 틀의 공 중심(세계 설명 preloads[i].position)
  position: Vec3
  // 편집 자세 로봇 좌표의 공 중심(겹침 검사·표시)
  inRobot: Vec3
}

// 로봇의 프리로드 출처: slots(팀이 둔 Preload Slot, 끈 것만 있어도), auto(자동 배치, face 면), noRoom(자동 배치를 못 찾음),
// season(시즌에 경기 요소가 없음: 'none'·모르는 시즌)
export type PreloadSource = 'slots' | 'auto' | 'noRoom' | 'season'

export type RobotPreloads = {
  source: PreloadSource
  // auto일 때 면(아니면 null)
  face: PreloadFace | null
  slots: PreloadSlot[]
  // Preload Slot 오브젝트 id → 빠진 이유(slots일 때만)
  exclusions: Map<string, PreloadExclusion>
  // 켠 자리가 MAX_PRELOADS를 넘었다
  tooMany: boolean
  // POLLEN 반지름(m, 시즌에 없으면 0)
  radius: number
}

// 6a에 생기는 배치 묶음(spec-6a §4: GARDEN만. FLOWER·CELL은 6b, 사람 선수는 6d)
export const RUN_ELEMENT_GROUPS: readonly SimElementGroup[] = ELEMENT_GROUPS

// Matrix4(로봇 좌표 몸체 틀) → Frame3(행 우선 회전, 원점)
export function frameOfMatrix(matrix: Matrix4): Frame3 {
  const e = matrix.elements
  return {
    rotation: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]],
    origin: { x: e[12], y: e[13], z: e[14] }
  }
}

const vec = (v: Vector3): Vec3 => ({ x: plain(v.x), y: plain(v.y), z: plain(v.z) })
const inLimit = (p: Vec3): boolean =>
  Math.abs(p.x) <= MAX_PRELOAD_EXTENT &&
  Math.abs(p.y) <= MAX_PRELOAD_EXTENT &&
  Math.abs(p.z) <= MAX_PRELOAD_EXTENT

// 로봇 시작 자세(최상위 로봇의 transform, 요는 (−π, π])
export function robotStartPose(objects: SceneObjects, robotId: string): Pose2 | null {
  const robot = objects[robotId]
  if (!robot || robot.kind !== 'robot') return null
  const [x, y] = robot.transform.position
  return { x, y, yaw: wrapAngle(robot.transform.rotation[2]) }
}

// 문서·로봇·시즌마다 한 번(씬 문서는 불변이다). 인스펙터 카드·로봇 카드·씬 뷰가 같은 결과를 쓴다
const memo = new WeakMap<SceneObjects, Map<string, RobotPreloads>>()

// 로봇의 프리로드 자리(위 머리 주석의 규칙). joints는 몸체 나누기(같은 문서, 없으면 계산한다)
export function robotPreloads(
  objects: SceneObjects,
  robotId: string,
  field: FieldSpec,
  joints?: JointBodyFrames
): RobotPreloads {
  let byKey = memo.get(objects)
  if (!byKey) memo.set(objects, (byKey = new Map()))
  const key = `${robotId}\u0000${field.season}`
  const cached = byKey.get(key)
  // 시험이 바꾼 시즌 판(얕은 복사)은 기억하지 않는다(같은 시즌 이름의 다른 값)
  const frozen = field === resolveSeason(field.season)
  if (cached && frozen) return cached
  const result = computePreloads(objects, robotId, field, joints)
  if (frozen) byKey.set(key, result)
  return result
}

function computePreloads(
  objects: SceneObjects,
  robotId: string,
  field: FieldSpec,
  joints: JointBodyFrames | undefined
): RobotPreloads {
  const type = resolveElementType(field, 'pollen')
  const empty = (source: PreloadSource): RobotPreloads => ({
    source,
    face: null,
    slots: [],
    exclusions: new Map(),
    tooMany: false,
    radius: type?.radius ?? 0
  })
  if (!type || !field.elements) return empty('season')
  const start = robotStartPose(objects, robotId)
  if (!start) return empty('season')
  const radius = type.radius
  const ids = robotPreloadIds(objects, robotId)
  if (ids.length === 0) {
    const auto = autoPreloadSlots(
      robotOutline(objects, robotId).footprint,
      field,
      start,
      RUN_ELEMENT_GROUPS
    )
    if (!auto) return empty('noRoom')
    return {
      ...empty('auto'),
      face: auto.face,
      slots: auto.slots.map((p) => ({
        objectId: null,
        name: '',
        body: -1,
        position: { x: plain(p.x), y: plain(p.y), z: plain(p.z) },
        inRobot: { ...p }
      }))
    }
  }
  const frames = joints ?? jointBodyFrames(objects, robotId)
  const result = empty('slots')
  for (const id of ids) {
    const object = objects[id]
    const preload = object.preload!
    if (!preloadEnabled(preload)) {
      result.exclusions.set(id, 'disabled')
      continue
    }
    if (result.slots.length === MAX_PRELOADS) {
      result.tooMany = true
      result.exclusions.set(id, 'tooMany')
      continue
    }
    const matrix = robotObjectMatrix(objects, robotId, id)
    if (!matrix) {
      result.exclusions.set(id, 'orphan')
      continue
    }
    const [cx, cy, cz] = preload.center
    const inRobotV = new Vector3(cx, cy, cz).applyMatrix4(matrix)
    const inRobot = vec(inRobotV)
    if (inRobot.z - radius < -EDIT_OVERLAP_TOLERANCE) {
      result.exclusions.set(id, 'belowFloor')
      continue
    }
    const body = frames.bodyOf.get(id) ?? -1
    const frame = body >= 0 ? frames.frames[body] : undefined
    const position = frame ? vec(inRobotV.clone().applyMatrix4(frame.clone().invert())) : inRobot
    if (!inLimit(position)) {
      result.exclusions.set(id, 'outOfRange')
      continue
    }
    result.slots.push({ objectId: id, name: object.name, body, position, inRobot })
  }
  return result
}

// 자리 하나의 겹침 대상(편집 자세, 분리 < −EDIT_OVERLAP_TOLERANCE): 그 로봇의 충돌 몸체(이름) 또는 앞 자리(오브젝트 이름).
// 첫 대상만(Console 한 줄). 없으면 null. bodies는 충돌 모델(play/worldColliders.ts, 몸체 틀 충돌체), frame은 몸체 번호 → 로봇
// 좌표 몸체 틀이다
export function preloadOverlaps(
  preloads: RobotPreloads,
  bodies: readonly WorldColliderBody[],
  frame: (body: number) => Frame3
): Map<number, string> {
  const out = new Map<number, string>()
  const r = preloads.radius
  const placed = bodies.flatMap((body) =>
    body.colliders.flatMap((entry) => {
      const shape = bodyShape(entry.collider)
      return shape ? [{ name: body.name, shape: placeShape(shape, frame(body.body)) }] : []
    })
  )
  preloads.slots.forEach((slot, i) => {
    const p = slot.inRobot
    const ball = { kind: 'capsule' as const, a: p, b: p, r, sphere: true }
    for (const target of placed)
      if (shapeSeparation(ball, target.shape) < -EDIT_OVERLAP_TOLERANCE) {
        out.set(i, target.name)
        return
      }
    for (let j = 0; j < i; j++) {
      const q = preloads.slots[j].inRobot
      const gap = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) - 2 * r
      if (gap < -EDIT_OVERLAP_TOLERANCE) {
        out.set(i, preloads.slots[j].name)
        return
      }
    }
  })
  return out
}

// 세계 설명의 프리로드(자리 순서)
export function preloadSpecs(preloads: RobotPreloads): SimPreloadSpec[] {
  return preloads.slots.map((slot) => ({
    kind: 'pollen',
    body: slot.body,
    position: { ...slot.position }
  }))
}

// 실행의 경기 요소(run.elements): 세계 설명 elements로 시뮬레이터가 첫 틱에 만들 공(shared elementSpawns, 같은 함수)의 종류와
// 시작 상태. 세계 설명에 경기 요소가 없으면 null
export function runElementsOf(spec: WorldSpec | null): PlayRunElements | null {
  if (!spec?.elements) return null
  const spawns = elementSpawns(
    resolveSeason(spec.field.season),
    spec.elements,
    spec.robot.start,
    restBodyFrames(spec.joints)
  )
  return { kinds: spawns.map((s) => s.kind), spawns }
}

// INIT(playActions.worldFor): 실행의 경기 요소를 세계 설명에 넣고 경고를 더한다(withRunField 뒤, 실행의 시즌으로). 개인 설정
// gameElements가 꺼졌거나(field.gameElements), 시즌에 경기 요소가 없거나, 세계 설명이 없으면 그대로 둔다(elements 키 없음).
// 경고 순서: 한도(worldTooManyPreloads) → 자리마다 바닥 아래(worldPreloadBelowFloor) → 겹침(worldPreloadOverlap) → 자동 배치
// 실패(worldPreloadNoRoom). 겹침은 경고만이다(시뮬레이터가 밀어낸다)
export function withElements(
  result: WorldSpecResult,
  objects: SceneObjects,
  robotId: string,
  field: PlayRunField,
  t: TFunction
): WorldSpecResult {
  const spec = result.spec
  if (!spec || field.gameElements !== true) return result
  const fieldSpec = resolveSeason(field.season)
  if (!fieldSpec.elements) return result
  const preloads = robotPreloads(objects, robotId, fieldSpec)
  const warnings = [...result.warnings]
  if (preloads.tooMany)
    warnings.push({ key: 'worldTooManyPreloads', params: { max: MAX_PRELOADS } })
  for (const id of robotPreloadIds(objects, robotId))
    if (preloads.exclusions.get(id) === 'belowFloor')
      warnings.push({ key: 'worldPreloadBelowFloor', params: { name: objects[id].name } })
  const frames = restBodyFrames(spec.joints)
  for (const [i, target] of preloadOverlaps(preloads, result.colliders, frames))
    warnings.push({
      key: 'worldPreloadOverlap',
      params: { name: preloads.slots[i].name || t('preload.autoName'), target }
    })
  if (preloads.source === 'noRoom') warnings.push({ key: 'worldPreloadNoRoom', params: {} })
  const next: WorldSpec = {
    ...spec,
    elements: { groups: [...RUN_ELEMENT_GROUPS], preloads: preloadSpecs(preloads) }
  }
  // 메인과 같은 검사(자리는 이미 한도 안이라 거절되지 않는다. 거절되면 경기 요소 없이 실행한다)
  const checked = parseWorldSpec(next)
  if (typeof checked === 'string') return { ...result, warnings }
  return { ...result, spec: checked, warnings }
}
