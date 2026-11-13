import {
  collideShapes,
  GJK_MIN_DISTANCE,
  type ManifoldPoint,
  type PlacedShape
} from '../collision3d'
import type { Hull } from '../hull'
import type { Vec3 } from '../worldSpec'

// 공(구)의 좁은 단계와 접촉 행 값(6a, spec-6a §2.2–§2.4). 순수·결정적이다.
//
// 법선 규약: 법선은 다른 몸체(바닥·정적·로봇·다른 공)에서 공 쪽으로 가는 단위 벡터이고, 분리는 두 표면 사이(음수 = 침투)다. 점은
// 두 표면의 가운데(collision3d.ts 규약과 같다: c − n·(r + 분리/2))다. 정적 껍질·로봇 껍질·캡슐은 지금 좁은 단계(collideShapes,
// 공 = 선분 길이 0인 캡슐)를 그대로 쓰고, 원기둥 충돌체(6a)는 정확한 구–원기둥 최근접(옆면·뚜껑·모서리)이다.

export type V3 = [number, number, number]

export type BallContact = { normal: V3; point: V3; separation: number }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (a: V3): number => Math.sqrt(dot(a, a))
const vec = (v: V3): Vec3 => ({ x: v[0] + 0, y: v[1] + 0, z: v[2] + 0 })
const arr = (v: Vec3): V3 => [v.x, v.y, v.z]

// 법선·분리로 낸 접촉(점은 두 표면의 가운데)
function contactOf(c: V3, r: number, normal: V3, separation: number): BallContact {
  return { normal, separation, point: sub(c, scale(normal, r + separation / 2)) }
}

// 바닥(z = 0, 법선 +z)
export function sphereFloor(c: V3, r: number, band: number): BallContact | null {
  const separation = c[2] - r
  if (separation > band) return null
  return contactOf(c, r, [0, 0, 1], separation)
}

const sphereShape = (c: V3, r: number): PlacedShape => ({
  kind: 'capsule',
  a: vec(c),
  b: vec(c),
  r,
  sphere: true
})

// 매니폴드 점 하나(구라 점은 늘 하나) → 접촉. 법선은 B → A(A = 공)
function fromPoint(point: ManifoldPoint): BallContact {
  return {
    normal: arr(point.normal),
    point: arr(point.position),
    separation: point.separation
  }
}

// 볼록 껍질(정적 형상, 로봇 상자·볼록·원기둥 근사 껍질): collideShapes(공, 껍질) → collideHullRound(GJK 얕음, SAT 깊음)
export function sphereHull(c: V3, r: number, hull: Hull, band: number): BallContact | null {
  const result = collideShapes(sphereShape(c, r), { kind: 'hull', hull }, band, null)
  const point = result.manifold?.points[0]
  return point ? fromPoint(point) : null
}

// 캡슐·구(로봇 충돌체): collideShapes(공, 캡슐) → collideCapsules(선분 최근접)
export function sphereCapsule(
  c: V3,
  r: number,
  capsule: { a: Vec3; b: Vec3; r: number; sphere: boolean },
  band: number
): BallContact | null {
  const result = collideShapes(
    sphereShape(c, r),
    { kind: 'capsule', a: capsule.a, b: capsule.b, r: capsule.r, sphere: capsule.sphere },
    band,
    null
  )
  const point = result.manifold?.points[0]
  return point ? fromPoint(point) : null
}

// 축 정렬 상자 [min, max](벽: collision3d.ts staticShapes의 axisBox, 꼭짓점이 경계 그대로)와 구의 정확한 최근접. 밖이면 상자 위
// 가장 가까운 점(좌표마다 자름)에서 법선, 안(표면 위 포함)이면 가장 얕은 면(−x, +x, −y, +y, −z, +z 순, 엄격한 <)의 바깥 법선.
// 껍질 GJK(sphereHull)와 같은 기하를 할당 없이 낸다(벽은 공이 가장 자주 닿는 정적 형상이다)
export function sphereBox(c: V3, r: number, min: V3, max: V3, band: number): BallContact | null {
  const q: V3 = [
    Math.min(max[0], Math.max(min[0], c[0])),
    Math.min(max[1], Math.max(min[1], c[1])),
    Math.min(max[2], Math.max(min[2], c[2]))
  ]
  const offset = sub(c, q)
  const d = length(offset)
  if (d - r > band) return null
  if (d > GJK_MIN_DISTANCE) return contactOf(c, r, scale(offset, 1 / d), d - r)
  let normal: V3 = [-1, 0, 0]
  let depth = c[0] - min[0]
  const faces: [number, V3][] = [
    [max[0] - c[0], [1, 0, 0]],
    [c[1] - min[1], [0, -1, 0]],
    [max[1] - c[1], [0, 1, 0]],
    [c[2] - min[2], [0, 0, -1]],
    [max[2] - c[2], [0, 0, 1]]
  ]
  for (const [value, n] of faces)
    if (value < depth) {
      depth = value
      normal = n
    }
  return contactOf(c, r, normal, -Math.max(0, depth) - r)
}

// d에 수직인 단위 축: |d_k|가 가장 작은 축(같으면 작은 k)과의 외적(collision3d.ts perpendicularTo와 같은 규칙)
function perpendicularTo(d: V3): V3 {
  let k = 0
  if (Math.abs(d[1]) < Math.abs(d[k])) k = 1
  if (Math.abs(d[2]) < Math.abs(d[k])) k = 2
  const e: V3 = [0, 0, 0]
  e[k] = 1
  const t: V3 = [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]]
  const l = length(t)
  return [t[0] / l, t[1] / l, t[2] / l]
}

// 속이 찬 원기둥(뚜껑 중심 a·b, 반지름 R, 납작한 뚜껑)과 구의 정확한 최근접(spec-6a §1 "공과의 짝은 정확한 구–원기둥").
// 구 중심 c가 원기둥 밖이면 원기둥 위 가장 가까운 점 q(축 좌표를 [0, L]로, 반지름 성분을 R로 자름: 옆면·뚜껑·모서리가 이 하나로
// 나온다)에서 법선 (c − q)/|c − q|, 분리 |c − q| − r. 안이면(표면 위 포함) 가장 가까운 면(뚜껑 a → 뚜껑 b → 옆면 순, 엄격한 <)의
// 바깥 법선이고 분리는 −(그 면까지 깊이) − r이다. 축 위의 중심이 옆면으로 나가면 축에 수직인 정해진 축을 쓴다
export function sphereCylinder(
  c: V3,
  r: number,
  a: V3,
  b: V3,
  radius: number,
  band: number
): BallContact | null {
  const axis = sub(b, a)
  const len = length(axis)
  const e = scale(axis, 1 / len)
  const rel = sub(c, a)
  const t = dot(rel, e)
  const radial = sub(rel, scale(e, t))
  const rho = length(radial)
  if (t < 0 || t > len || rho > radius) {
    const tc = Math.min(len, Math.max(0, t))
    const out = rho > radius ? scale(radial, radius / rho) : radial
    const q = add(add(a, scale(e, tc)), out)
    const offset = sub(c, q)
    const d = length(offset)
    if (d - r > band) return null
    if (d > GJK_MIN_DISTANCE) return contactOf(c, r, scale(offset, 1 / d), d - r)
  }
  // 안(또는 표면 위): 가장 얕은 면
  let normal: V3 = scale(e, -1)
  let depth = t
  if (len - t < depth) {
    normal = e
    depth = len - t
  }
  if (radius - rho < depth) {
    normal = rho > 0 ? scale(radial, 1 / rho) : perpendicularTo(e)
    depth = radius - rho
  }
  return contactOf(c, r, normal, -Math.max(0, depth) - r)
}

// 두 공(e, f): 법선은 f에서 e로, 분리는 중심 거리 − 반지름 합. 중심이 겹치면 +z
export function sphereSphere(
  ce: V3,
  re: number,
  cf: V3,
  rf: number,
  band: number
): BallContact | null {
  const offset = sub(ce, cf)
  const d = length(offset)
  const separation = d - re - rf
  if (separation > band) return null
  const normal: V3 = d > GJK_MIN_DISTANCE ? scale(offset, 1 / d) : [0, 0, 1]
  return contactOf(ce, re, normal, separation)
}

// ---- 부드러운 법선 행(spec-6a §2.3) ----

export type NormalRowInput = {
  // 두 표면의 분리(음수 = 침투 δ)
  separation: number
  // 자유 예측 속도의 법선 접근 속도 v_n* = J·u*(음수 = 다가옴)
  approach: number
  // 앞 하위 단계에 이 짝이 표면까지 와서 멈춘(예측 도착) 때의 접근 속도(음수), 없으면 undefined
  impact?: number
  h: number
  // 접촉 스프링(N/m)과 유효 질량(kg), 감쇠비 ζ: 감쇠 c = 2ζ√(k·m)
  stiffness: number
  mass: number
  dampingRatio: number
  // 딱딱한 심 깊이(m): δ가 이 이상이면 강체 행
  coreDepth: number
  // 반발 계수(이 면 종류)
  restitution: number
  // 반발하는 접근 속도 문턱(m/s)
  bounceSpeed: number
}

export type NormalRow = {
  target: number
  // 순응 γ(0 = 강체 행)
  compliance: number
  crushed: boolean
  bounced: boolean
  // 이 하위 단계에 표면까지 와서 멈추게 한 접근 속도(다음 하위 단계가 반발에 쓴다), 아니면 undefined
  arrival?: number
}

// 법선 행의 목표와 순응(spec-6a §2.3).
// - 반발 두 단계[결정: spec-6a의 한 행 투기 반발 e·(−v_n*) − (1 + e)·분리/h는 속도에 위치 보정을 섞어, 닿기 전 하위 단계에 접근
//   속도를 깎고 다음 하위 단계가 그 깎인 속도로 반발해 0.5 m 낙하가 e² 대신 약 0.03배만 튀었다]: 접근이 문턱보다 빠르고 이 하위
//   단계에 표면에 닿으면(분리 > 0) 강체 행으로 표면까지만 오게 하고(목표 −분리/h) 그 접근 속도를 적어 둔다(arrival). 다음 하위
//   단계(impact)나 이미 닿은 채 빠르게 다가오면(분리 ≤ 0) 강체 목표 e·(−접근 속도)로 튄다. 위치·속도 모두 맞고 표면에 한 하위
//   단계(1 ms) 머문다.
// - 침투 δ > 0: ODE ERP·CFM 꼴의 암시 스프링–감쇠(목표 = (h·k/(h·k + c))·δ/h, γ = 1/(h·(h·k + c)), 정지 상태 힘 = k·δ).
// - 떨어짐(분리 ≥ 0): 예측 목표 −분리/h에 같은 γ.
// - 심(δ ≥ coreDepth): 강체(γ = 0, 목표 0, 밀어내지 않음).
export function normalRow(input: NormalRowInput): NormalRow {
  const { separation, approach, h, stiffness: k, mass, coreDepth, restitution: e } = input
  if (input.impact !== undefined && input.impact < -input.bounceSpeed)
    return {
      target: e * -input.impact - ((1 + e) * Math.max(separation, 0)) / h,
      compliance: 0,
      crushed: false,
      bounced: true
    }
  if (approach < -input.bounceSpeed) {
    if (separation <= 0)
      return { target: e * -approach, compliance: 0, crushed: false, bounced: true }
    if (-approach * h > separation)
      return {
        target: -separation / h,
        compliance: 0,
        crushed: false,
        bounced: false,
        arrival: approach
      }
  }
  const depth = -separation
  if (depth >= coreDepth) return { target: 0, compliance: 0, crushed: true, bounced: false }
  const c = 2 * input.dampingRatio * Math.sqrt(k * mass)
  const compliance = 1 / (h * (h * k + c))
  if (depth > 0)
    return { target: (k * depth) / (h * k + c), compliance, crushed: false, bounced: false }
  return { target: -separation / h, compliance, crushed: false, bounced: false }
}
