import { rotationZYX } from '../articulation'
import { sphereShapeSeparation } from '../seasons/fieldGeometry'
import type { Alliance, FieldSpec } from '../seasons/fieldSpec'
import { composeFrames, type Frame3 } from '../sensorFrame'
import type {
  Pose2,
  SimElementGroup,
  SimElementKind,
  SimElementState,
  SimElementsSpec,
  SimJointSpec,
  Vec2,
  Vec3
} from '../worldSpec'
import { MAX_PRELOADS, resolveElementType, SLOT_GAP } from './elementData'

// 경기 요소가 생기는 자리(6a, spec-6a §1·§2.8·§4). 순수·결정적이고 시뮬레이터(elementWorld)와 렌더러(세계 설명 빌더·편집
// 표시)가 같은 함수를 쓴다: 그래서 렌더러가 보이는 시작 배치·자동 프리로드 자리와 시뮬레이터의 첫 틱 자리가 같다.

const IDENTITY_FRAME: Frame3 = Object.freeze({
  rotation: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  origin: Object.freeze({ x: 0, y: 0, z: 0 })
})

// 세계 설명 관절 몸체들의 편집 자세(q = 0) 틀(로봇 좌표): 몸체 −1은 로봇 좌표 그대로, 관절 i는 부모 몸체 틀 ∘ (origin.position,
// ZYX origin.rotation). Articulation 몸체 자세와 같은 규칙이다. 없는 몸체 번호는 던진다(parseWorldSpec가 막는다)
export function restBodyFrames(joints: readonly SimJointSpec[]): (body: number) => Frame3 {
  const frames: Frame3[] = []
  for (const j of joints) {
    const parent = j.parent < 0 ? IDENTITY_FRAME : frames[j.parent]
    frames.push(
      composeFrames(parent, { rotation: rotationZYX(j.origin.rotation), origin: j.origin.position })
    )
  }
  return (body) => {
    if (body < 0) return IDENTITY_FRAME
    const frame = frames[body]
    if (!frame) throw new RangeError(`elements: unknown body ${body}`)
    return frame
  }
}

// 로봇 좌표 점 → 필드 좌표(시작 자세 Rz(yaw), 원점 (x, y, 0)). −0 없이
function robotToField(start: Pose2, p: Vec3): Vec3 {
  const c = Math.cos(start.yaw)
  const s = Math.sin(start.yaw)
  return { x: c * p.x - s * p.y + start.x + 0, y: s * p.x + c * p.y + start.y + 0, z: p.z + 0 }
}

// 몸체 틀 위의 점 → 로봇 좌표
function bodyToRobot(frame: Frame3, p: Vec3): Vec3 {
  const r = frame.rotation
  const o = frame.origin
  return {
    x: r[0] * p.x + r[1] * p.y + r[2] * p.z + o.x,
    y: r[3] * p.x + r[4] * p.y + r[5] * p.z + o.y,
    z: r[6] * p.x + r[7] * p.y + r[8] * p.z + o.z
  }
}

function state(kind: SimElementKind, position: Vec3, asleep: boolean): SimElementState {
  return {
    kind,
    position: { x: position.x + 0, y: position.y + 0, z: position.z + 0 },
    orientation: [1, 0, 0, 0],
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    asleep,
    out: false
  }
}

// 실행 시작의 공(필드 좌표). 순서가 공 번호다: 시즌 배치(FieldSpec.elements.layout 배열 순서, elements.groups에 든 묶음만,
// 쉬는 상태로 잠들어 생긴다) → 프리로드(자리 순서, 깨어 있다). start: 로봇 시작 자세, bodyFrame: 몸체의 편집 자세 틀(로봇
// 좌표, restBodyFrames). 세계 설명에 경기 요소가 없거나 시즌에 없으면 []
export function elementSpawns(
  field: FieldSpec,
  elements: SimElementsSpec | undefined,
  start: Pose2,
  bodyFrame: (body: number) => Frame3 = restBodyFrames([])
): SimElementState[] {
  if (!elements || !field.elements) return []
  const out: SimElementState[] = []
  for (const p of field.elements.layout)
    if (elements.groups.includes(p.group)) out.push(state(p.kind, p.position, true))
  for (const p of elements.preloads)
    out.push(state(p.kind, robotToField(start, bodyToRobot(bodyFrame(p.body), p.position)), false))
  return out
}

// ---- 자동 프리로드 자리(사용자 결정 11/13: 팀이 자리를 두지 않으면 로봇 앞 타일, 막혔으면 뒤 → 왼쪽 → 오른쪽) ----

export type PreloadFace = 'front' | 'back' | 'left' | 'right'
export const PRELOAD_FACES: readonly PreloadFace[] = ['front', 'back', 'left', 'right']

// 공(필드 좌표 중심, 반지름)이 필드 밖으로 나가거나 공이 부딪히는 구조물(carrier field이고 solid ∨ occludes, collision3d.ts
// staticShapes와 같은 집합)이나 다른 공과 겹치는지. 정확히 닿기만 한 것(분리 0)은 막히지 않는다
function blocked(
  field: FieldSpec,
  center: Vec3,
  radius: number,
  others: readonly { position: Vec3; radius: number }[]
): boolean {
  const limit = field.perimeter.innerHalf
  if (Math.abs(center.x) + radius > limit || Math.abs(center.y) + radius > limit) return true
  for (const s of field.structures) {
    if (s.carrier !== 'field' || !(s.solid || s.occludes)) continue
    if (sphereShapeSeparation(center, radius, s.shape) < 0) return true
  }
  for (const o of others) {
    const d = Math.hypot(o.position.x - center.x, o.position.y - center.y, o.position.z - center.z)
    if (d - o.radius - radius < 0) return true
  }
  return false
}

// 외곽(로봇 좌표 다각형)의 한 면 밖에 바닥에 놓은 공 MAX_PRELOADS개의 자리(로봇 좌표): 공 중심은 그 면의 가장 바깥 좌표에서
// r + SLOT_GAP 밖, 면을 따라 외곽 경계 상자 가운데를 중심으로 2r + SLOT_GAP 간격, z = r. 자리 순서는 면을 따라 −쪽부터다
function faceSlots(footprint: readonly Vec2[], face: PreloadFace, radius: number): Vec3[] {
  const xs = footprint.map((p) => p.x)
  const ys = footprint.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const pitch = 2 * radius + SLOT_GAP
  const offset = radius + SLOT_GAP
  return Array.from({ length: MAX_PRELOADS }, (_, k) => {
    const along = (k - (MAX_PRELOADS - 1) / 2) * pitch
    switch (face) {
      case 'front':
        return { x: maxX + offset, y: (minY + maxY) / 2 + along, z: radius }
      case 'back':
        return { x: minX - offset, y: (minY + maxY) / 2 + along, z: radius }
      case 'left':
        return { x: (minX + maxX) / 2 + along, y: maxY + offset, z: radius }
      case 'right':
        return { x: (minX + maxX) / 2 + along, y: minY - offset, z: radius }
    }
  })
}

// 팀이 Preload Slot을 두지 않은 로봇의 프리로드 POLLEN 자리(로봇 좌표, 몸체 −1). 앞 → 뒤 → 왼쪽 → 오른쪽 면 가운데 네 자리가
// 모두 필드 안이고 구조물·고른 배치 묶음(groups, 같은 실행에 생길 시즌 공)과 겹치지 않는 첫 면이다. 모든 면이 막혔거나 시즌에
// POLLEN이 없으면 null(프리로드 없이 실행하고 worldPreloadNoRoom). start: 로봇 시작 자세(필드 좌표)
export function autoPreloadSlots(
  footprint: readonly Vec2[],
  field: FieldSpec,
  start: Pose2,
  groups: readonly SimElementGroup[] = []
): { face: PreloadFace; slots: Vec3[] } | null {
  const type = resolveElementType(field, 'pollen')
  if (!type || footprint.length === 0) return null
  const others = (field.elements?.layout ?? []).flatMap((p) => {
    if (!groups.includes(p.group)) return []
    const t = resolveElementType(field, p.kind)
    return t ? [{ position: p.position, radius: t.radius }] : []
  })
  for (const face of PRELOAD_FACES) {
    const slots = faceSlots(footprint, face, type.radius)
    if (slots.every((p) => !blocked(field, robotToField(start, p), type.radius, others)))
      return { face, slots }
  }
  return null
}

// ---- 다시 넣기(spec-6a §2.8, 사용자 결정 11/13) ----

// LOADING ZONE 하나의 다시 넣는 자리. zone: FieldSpec.zones 순번, center: 구역 가운데(필드 좌표 바닥), slots: 벽 안쪽 면에서
// r + SLOT_GAP 떨어져 바닥에 놓인 공 중심(z = r)을 구역 가운데부터 바깥으로(가운데, +쪽, −쪽, +2, −2 …) 둔 것. +쪽은 그 벽을
// 필드 안에서 볼 때 왼쪽(t = ẑ × 안쪽 법선)이라 빨강·파랑 자리가 Rz(π) 대칭이다. 구역 폭 안(가장자리에서 r)만이다
export type ReentryZone = { zone: number; alliance: Alliance; center: Vec2; slots: Vec3[] }

// 구역 사각형이 닿은 벽(안쪽 면 = ±innerHalf와 같은 가장자리)의 안쪽 법선. 없으면 null
function wallNormal(rect: readonly number[], innerHalf: number): Vec2 | null {
  const [x0, y0, x1, y1] = rect
  if (y0 === -innerHalf) return { x: 0, y: 1 }
  if (y1 === innerHalf) return { x: 0, y: -1 }
  if (x0 === -innerHalf) return { x: 1, y: 0 }
  if (x1 === innerHalf) return { x: -1, y: 0 }
  return null
}

// 그 종류 공을 다시 넣는 구역(FieldSpec.zones의 loadingZone, 배열 순서: 같은 거리면 앞 구역 = BIOBUZZ 빨강). 시즌에 그 종류가
// 없거나 다시 넣지 않는 종류(reentry false)면 []. 벽에 닿지 않은 구역은 뺀다
export function reentryZones(field: FieldSpec, kind: SimElementKind): ReentryZone[] {
  const type = resolveElementType(field, kind)
  if (!type || !type.reentry) return []
  const r = type.radius
  const innerHalf = field.perimeter.innerHalf
  const out: ReentryZone[] = []
  field.zones.forEach((zone, index) => {
    if (zone.key !== 'loadingZone') return
    const n = wallNormal(zone.rect, innerHalf)
    if (!n) return
    const [x0, y0, x1, y1] = zone.rect
    const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
    // 벽을 따른 방향 t = ẑ × n = (−n.y, n.x)와 그 방향의 구역 반폭
    const t = { x: -n.y + 0, y: n.x + 0 }
    const halfWidth = Math.abs(t.x) * ((x1 - x0) / 2) + Math.abs(t.y) * ((y1 - y0) / 2)
    const reach = halfWidth - r
    // 벽 안쪽 면에서 r + SLOT_GAP: 벽 쪽 좌표 −innerHalf·(n) 기준
    const depth = innerHalf - r - SLOT_GAP
    const base = { x: n.x === 0 ? center.x : -n.x * depth, y: n.y === 0 ? center.y : -n.y * depth }
    const pitch = 2 * r + SLOT_GAP
    const slots: Vec3[] = []
    if (reach >= 0) {
      slots.push({ x: base.x + 0, y: base.y + 0, z: r })
      for (let k = 1; k * pitch <= reach; k++)
        for (const sign of [1, -1])
          slots.push({
            x: base.x + sign * k * pitch * t.x + 0,
            y: base.y + sign * k * pitch * t.y + 0,
            z: r
          })
    }
    out.push({ zone: index, alliance: zone.alliance, center, slots })
  })
  return out
}

// 나간 자리(필드 좌표 바닥)에서 가운데가 가장 가까운 구역(같은 거리면 앞 구역). 구역이 없으면 null
export function nearestReentryZone(zones: readonly ReentryZone[], exit: Vec2): ReentryZone | null {
  let best: ReentryZone | null = null
  let bestDistance = Infinity
  for (const z of zones) {
    const d = Math.hypot(z.center.x - exit.x, z.center.y - exit.y)
    if (d < bestDistance) {
      best = z
      bestDistance = d
    }
  }
  return best
}
