import type { TFunction } from 'i18next'
import { Vector3, type Matrix4 } from 'three'
import {
  bodyShape,
  EDIT_OVERLAP_TOLERANCE,
  placeShape,
  shapeBounds,
  type PlacedShape
} from '../../../shared/sim/collision3d'
import {
  sphereCapsule,
  sphereCylinder,
  sphereHull,
  type BallContact,
  type V3
} from '../../../shared/sim/elements/ballContact'
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
import { jointBodyFrames } from './worldJoints'
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
  // POLLEN 딱딱한 심 깊이(m, 시즌 contact.coreDepthRatio × 반지름, 시즌에 없으면 0): 이보다 깊이 겹친 자리의 공은 시작할 때
  // 그 겹침이 밀어내지 않는다(시뮬레이터 ballContact.ts normalRow: 시작부터 심 이상 겹친 짝의 심 행은 목표 0이다)
  coreDepth: number
}

// 자리 하나의 편집 자세 겹침이 시작할 때 어떻게 되는지: pushedOut(시뮬레이터가 보통 밀어낸다: 벌어진 두 면 사이에서는 마찰이
// 붙잡을 수 있다), embedded(어느 대상과 심 이상 겹쳐 심 행이 밀어내지 않는다: 박힌 채 남거나, 다른 겹침·중력에 밀려 풀리며 튀어
// 나갈 수 있다), squeezed(겹침은 모두 심보다 얕지만 반대쪽에도 겹쳐 빠져나갈 자리가 없다: 양쪽 스프링에 눌린 채 남는다). 문구
// (console.notices.worldPreload*, preload.*)는 이 범위만 말한다[결정: 6a 리뷰 3. 박힘·밀려남을 더 가르는 장치를 두지 않는다]
export type PreloadOutcome = 'pushedOut' | 'embedded' | 'squeezed'

// 자리 하나의 편집 자세 겹침: 대상 이름(Console·카드에 하나)과 결과
export type PreloadOverlap = { target: string; outcome: PreloadOutcome }

// 실행에 생기는 배치 묶음(GARDEN 6a, FLOWER·CELL 6b. 사람 선수는 6d)
export const RUN_ELEMENT_GROUPS: readonly SimElementGroup[] = ELEMENT_GROUPS
// 자동 프리로드 자리가 피할 배치 묶음: HIVE CELL 공은 바닥 근처에 오지 않아 뺀다(spec-6b §5: 그래서 robotPreloads 기억이 HIVE
// 시작 상태에 기대지 않는다)
export const AUTO_PRELOAD_GROUPS: readonly SimElementGroup[] = RUN_ELEMENT_GROUPS.filter(
  (group) => group !== 'hiveCell'
)

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

// 문서·로봇·시즌마다 한 번(씬 문서는 불변이다). 인스펙터 카드·로봇 카드·씬 뷰·INIT이 같은 결과를 쓴다. 결과는 그 문서만으로
// 정해진다(몸체 나누기도 그 문서로 계산한다)[결정: 6a 리뷰. 부르는 쪽이 몸체 나누기를 넘기던 때는 핸들 드래그 중 카드가 드래그 전
// 문서의 관절 틀을 넘겨 드래그 뒤 문서의 기억이 틀린 몸체 틀 위치를 가졌고, INIT이 그 값을 세계 설명에 실어 공이 그린 자리에서
// 드래그한 만큼 떨어져 생겼다]
const memo = new WeakMap<SceneObjects, Map<string, RobotPreloads>>()

// 로봇의 프리로드 자리(위 머리 주석의 규칙)
export function robotPreloads(
  objects: SceneObjects,
  robotId: string,
  field: FieldSpec
): RobotPreloads {
  let byKey = memo.get(objects)
  if (!byKey) memo.set(objects, (byKey = new Map()))
  const key = `${robotId}\u0000${field.season}`
  const cached = byKey.get(key)
  // 시험이 바꾼 시즌 판(얕은 복사)은 기억하지 않는다(같은 시즌 이름의 다른 값)
  const frozen = field === resolveSeason(field.season)
  if (cached && frozen) return cached
  const result = computePreloads(objects, robotId, field)
  if (frozen) byKey.set(key, result)
  return result
}

function computePreloads(objects: SceneObjects, robotId: string, field: FieldSpec): RobotPreloads {
  const type = resolveElementType(field, 'pollen')
  const empty = (source: PreloadSource): RobotPreloads => ({
    source,
    face: null,
    slots: [],
    exclusions: new Map(),
    tooMany: false,
    radius: type?.radius ?? 0,
    coreDepth: type ? type.contact.coreDepthRatio * type.radius : 0
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
      AUTO_PRELOAD_GROUPS
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
  const frames = jointBodyFrames(objects, robotId)
  const result = empty('slots')
  // 한도는 켠 자리를 하이어라키 순서로 센다(앞의 MAX_PRELOADS개가 후보이고, 그 가운데 바닥 아래·좌표 한도 밖은 빠진다: 뒤의
  // 자리가 대신 들어오지 않아 편집 중 다른 자리를 고쳐도 어느 자리가 쓰이는지가 하이어라키 순서로만 정해진다)
  let candidates = 0
  for (const id of ids) {
    const object = objects[id]
    const preload = object.preload!
    if (!preloadEnabled(preload)) {
      result.exclusions.set(id, 'disabled')
      continue
    }
    if (candidates === MAX_PRELOADS) {
      result.tooMany = true
      result.exclusions.set(id, 'tooMany')
      continue
    }
    candidates++
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

// 빠져나갈 자리를 찾는 위치 풀이의 회차 수(Gauss–Seidel 투영) [결정: 자리 넷·충돌체 수십에서 ms 아래. 서로 마주 본 면 사이처럼
// 자리가 없으면 끝까지 겹침이 남고, 아주 좁은 쐐기(열린 각 약 10° 아래)처럼 오래 걸리면 squeezed로 본다. 그보다 넓은 쐐기는
// 마찰이 붙잡아도(열린 각 2·atan μ 아래) pushedOut이다: 풀이에 마찰이 없다]
const PRELOAD_RELAX_SWEEPS = 50

// 몸체 틀 충돌체를 로봇 좌표에 놓은 것(공 짝은 시뮬레이터 elementWorld.ts와 같은 좁은 단계: 원기둥은 정확한 구–원기둥)
type PlacedTarget = {
  name: string
  shape: PlacedShape
  cylinder: { a: V3; b: V3; r: number } | null
  min: V3
  max: V3
}

const v3 = (p: Vec3): V3 => [p.x, p.y, p.z]

function placeTargets(
  bodies: readonly WorldColliderBody[],
  frame: (body: number) => Frame3
): PlacedTarget[] {
  return bodies.flatMap((body) =>
    body.colliders.flatMap((entry): PlacedTarget[] => {
      const shape = bodyShape(entry.collider)
      if (!shape) return []
      const f = frame(body.body)
      const placed = placeShape(shape, f)
      const bounds = shapeBounds(placed)
      const c = entry.collider
      const at = (p: Vec3): V3 => {
        const r = f.rotation
        return [
          r[0] * p.x + r[1] * p.y + r[2] * p.z + f.origin.x,
          r[3] * p.x + r[4] * p.y + r[5] * p.z + f.origin.y,
          r[6] * p.x + r[7] * p.y + r[8] * p.z + f.origin.z
        ]
      }
      return [
        {
          name: body.name,
          shape: placed,
          cylinder: c.kind === 'cylinder' ? { a: at(c.a), b: at(c.b), r: c.radius } : null,
          min: bounds.min,
          max: bounds.max
        }
      ]
    })
  )
}

// 공(중심 c, 반지름 r)과 충돌체의 접촉(법선은 충돌체 → 공), 경계 상자에서 band보다 멀면 null
function targetContact(c: V3, r: number, target: PlacedTarget, band: number): BallContact | null {
  for (let i = 0; i < 3; i++)
    if (c[i] + r + band < target.min[i] || c[i] - r - band > target.max[i]) return null
  if (target.cylinder)
    return sphereCylinder(c, r, target.cylinder.a, target.cylinder.b, target.cylinder.r, band)
  if (target.shape.kind === 'hull') return sphereHull(c, r, target.shape.hull, band)
  return sphereCapsule(c, r, target.shape, band)
}

// 자리마다 편집 자세 겹침의 결과(시뮬레이터 규칙, 겹침 = 분리 < −EDIT_OVERLAP_TOLERANCE). 대상은 그 로봇의 충돌 몸체(이름)와 앞
// 자리(오브젝트 이름)다(두 자리의 겹침은 뒤 자리에 한 번). bodies는 충돌 모델(play/worldColliders.ts, 몸체 틀 충돌체), frame은
// 몸체 번호 → 로봇 좌표 몸체 틀이다. 겹친 대상을 모두 본다[결정: 6a 리뷰 2. 첫 대상만 보면 뒤의 더 깊은 대상이나 반대쪽 겹침을
// 놓쳐 박힌 채 남을 공을 '밀려난다'고 알렸다]:
// - embedded: 어느 대상과 심 이상(충돌체와는 coreDepth, 다른 자리 공과는 두 공의 심 합 2·coreDepth: elementWorld.ts 공끼리 심과
//   같다) 겹친다. 시뮬레이터의 심 행은 목표 0이라 밀어내지 않는다(다른 겹침·중력에 밀려 심 아래로 풀리면 그 깊이의 탄성 힘에
//   튀어 나갈 수 있다: 문구가 둘 다 말한다). 대상은 심에 대해 가장 깊은 것(같으면 앞의 것)이다.
// - 아니면 시뮬레이터처럼 겹침이 공을 밀어내는지를 짧은 위치 풀이로 본다: 박히지 않은 자리 공을 모두 움직여(박힌 자리·충돌체는
//   고정, 심 이상 겹친 두 자리 사이는 풀지 않음, 바닥 z = r 아래로 가지 않음, 마찰·중력 없음) 겹친 대상에서 법선으로 겹친 만큼
//   빼내기를 PRELOAD_RELAX_SWEEPS회 되풀이한다. 그 자리의 겹침이 모두 EDIT_OVERLAP_TOLERANCE 안으로 풀리면 pushedOut(대상은 처음
//   겹친 앞의 것), 남으면 squeezed(대상은 끝에 가장 깊이 남은 것)다. 서로 마주 본 두 면 사이처럼 빠져나갈 자리가 없으면 양쪽
//   스프링이 맞서 공이 그대로 남는다. 마찰이 없는 풀이라, 벌어진 두 면 사이(열린 각이 2·atan μ 아래: 기본 마찰이면 약 48°)에서
//   마찰이 붙잡는 공도 pushedOut으로 본다(문구가 말한다)
export function preloadOverlaps(
  preloads: RobotPreloads,
  bodies: readonly WorldColliderBody[],
  frame: (body: number) => Frame3
): Map<number, PreloadOverlap> {
  const out = new Map<number, PreloadOverlap>()
  const r = preloads.radius
  const core = preloads.coreDepth
  const slots = preloads.slots
  if (slots.length === 0) return out
  const targets = placeTargets(bodies, frame)
  const start = slots.map((slot) => v3(slot.inRobot))
  const gapOf = (p: V3, q: V3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - 2 * r
  // 1. 처음 자리의 겹침(대상 순서: 충돌체 → 앞 자리)
  // slot: 앞 자리 공이면 그 순번
  type Hit = { name: string; depth: number; core: number; slot?: number }
  const hits = slots.map((_, i): Hit[] => {
    const found: Hit[] = []
    for (const target of targets) {
      const contact = targetContact(start[i], r, target, 0)
      if (contact && contact.separation < -EDIT_OVERLAP_TOLERANCE)
        found.push({ name: target.name, depth: -contact.separation, core })
    }
    for (let j = 0; j < i; j++) {
      const gap = gapOf(start[i], start[j])
      if (gap < -EDIT_OVERLAP_TOLERANCE)
        found.push({ name: slots[j].name, depth: -gap, core: 2 * core, slot: j })
    }
    return found
  })
  // 2. 심 이상 겹친 자리(박힘, 위치 풀이에서 고정). 공끼리 짝은 뒤 자리에만 적는다. 앞 자리 공은 고정하지 않고, 위치 풀이가 그
  // 짝의 겹침만 풀지 않는다(stuck)[결정: 6a 리뷰 3. 앞 자리도 고정으로 두고 고정 자리의 결과를 건너뛰어, 앞 자리 자신의 얕은
  // 겹침(옆판에 밀려남, 천장 판에 눌림) 경고가 사라졌다. 두 공 사이 심 행은 서로 다가가는 것만 막아 앞 자리 공은 다른 겹침에
  // 밀려 움직인다]
  const fixed = new Uint8Array(slots.length)
  const stuck = new Set<number>()
  const pairKey = (i: number, j: number): number => i * slots.length + j
  hits.forEach((found, i) => {
    let deepest: Hit | null = null
    for (const hit of found) {
      if (hit.depth < hit.core) continue
      if (hit.slot !== undefined) {
        stuck.add(pairKey(i, hit.slot))
        stuck.add(pairKey(hit.slot, i))
      }
      if (!deepest || hit.depth / hit.core > deepest.depth / deepest.core) deepest = hit
    }
    if (deepest) {
      fixed[i] = 1
      out.set(i, { target: deepest.name, outcome: 'embedded' })
    }
  })
  if (hits.every((found, i) => found.length === 0 || fixed[i])) return sorted(out)
  // 3. 빠져나갈 자리를 찾는 위치 풀이(박히지 않은 자리 공만 움직인다)
  const p = start.map((q): V3 => [q[0], q[1], q[2]])
  const residual = (i: number): { name: string; depth: number } | null => {
    let worst: { name: string; depth: number } | null = null
    for (const target of targets) {
      const contact = targetContact(p[i], r, target, 0)
      if (contact && contact.separation < -EDIT_OVERLAP_TOLERANCE)
        if (!worst || -contact.separation > worst.depth)
          worst = { name: target.name, depth: -contact.separation }
    }
    for (let j = 0; j < slots.length; j++) {
      if (j === i || stuck.has(pairKey(i, j))) continue
      const gap = gapOf(p[i], p[j])
      if (gap < -EDIT_OVERLAP_TOLERANCE && (!worst || -gap > worst.depth))
        worst = { name: slots[j].name, depth: -gap }
    }
    if (p[i][2] - r < -EDIT_OVERLAP_TOLERANCE && (!worst || r - p[i][2] > worst.depth))
      worst = { name: '', depth: r - p[i][2] }
    return worst
  }
  for (let sweep = 0; sweep < PRELOAD_RELAX_SWEEPS; sweep++) {
    let moved = false
    for (let i = 0; i < slots.length; i++) {
      if (fixed[i]) continue
      const c = p[i]
      for (const target of targets) {
        const contact = targetContact(c, r, target, 0)
        if (!contact || contact.separation >= 0) continue
        for (let k = 0; k < 3; k++) c[k] -= contact.normal[k] * contact.separation
        moved = true
      }
      for (let j = 0; j < slots.length; j++) {
        if (j === i || stuck.has(pairKey(i, j))) continue
        const d = [c[0] - p[j][0], c[1] - p[j][1], c[2] - p[j][2]]
        const length = Math.hypot(d[0], d[1], d[2])
        const gap = length - 2 * r
        if (gap >= 0 || length === 0) continue
        const share = fixed[j] ? 1 : 0.5
        for (let k = 0; k < 3; k++) {
          const push = (d[k] / length) * -gap * share
          c[k] += push
          if (!fixed[j]) p[j][k] -= push
        }
        moved = true
      }
      if (c[2] < r) {
        c[2] = r
        moved = true
      }
    }
    if (!moved) break
  }
  hits.forEach((found, i) => {
    if (found.length === 0 || fixed[i]) return
    const left = residual(i)
    if (!left) out.set(i, { target: found[0].name, outcome: 'pushedOut' })
    else out.set(i, { target: left.name || found[0].name, outcome: 'squeezed' })
  })
  return sorted(out)
}

// 자리 순서로 다시 넣은 지도(Console 경고 순서)
function sorted(map: Map<number, PreloadOverlap>): Map<number, PreloadOverlap> {
  return new Map([...map].sort((x, y) => x[0] - y[0]))
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
    restBodyFrames(spec.joints),
    spec.field.hiveTipped
  )
  return { kinds: spawns.map((s) => s.kind), spawns }
}

// 겹침 결과 → Console 경고 키(카드 문구는 preload.<결과>: PreloadCard)
export const PRELOAD_OVERLAP_NOTICE = {
  pushedOut: 'worldPreloadOverlap',
  embedded: 'worldPreloadEmbedded',
  squeezed: 'worldPreloadSqueezed'
} as const

// INIT(playActions.worldFor): 실행의 경기 요소를 세계 설명에 넣고 경고를 더한다(withRunField 뒤, 실행의 시즌으로). 개인 설정
// gameElements가 꺼졌거나(field.gameElements), 시즌에 경기 요소가 없거나, 세계 설명이 없으면 그대로 둔다(elements 키 없음).
// 경고 순서: 한도(worldTooManyPreloads) → 자리마다 바닥 아래(worldPreloadBelowFloor) → 겹침 → 자동 배치 실패
// (worldPreloadNoRoom). 겹침은 경고만이다(실행은 막지 않는다, preloadOverlaps의 결과): 얕은 겹침이 빠져나갈 자리가 있으면
// worldPreloadOverlap, 어느 대상과 심 이상 겹쳐 심 행이 밀어내지 않으면 worldPreloadEmbedded, 겹침이 얕아도 반대쪽에도 겹쳐 빠져나갈
// 자리가 없으면 worldPreloadSqueezed
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
  for (const [i, { target, outcome }] of preloadOverlaps(preloads, result.colliders, frames))
    warnings.push({
      key: PRELOAD_OVERLAP_NOTICE[outcome],
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
