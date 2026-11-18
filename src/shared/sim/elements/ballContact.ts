import {
  collideShapes,
  GJK_MIN_DISTANCE,
  type ManifoldPoint,
  type PlacedShape
} from '../collision3d'
import type { Hull } from '../hull'
import type { Vec3 } from '../worldSpec'
import { PINCH_RECOVERY_SPEED } from './elementData'

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
  // 딱딱한 심 깊이(m): δ가 이 이상이면 강체 행(붙드는 것이 없으면 되찾기: free)
  coreDepth: number
  // 반발 계수(이 면 종류)
  restitution: number
  // 반발하는 접근 속도 문턱(m/s)
  bounceSpeed: number
  // 끼임: 이 행의 법선이 같은 공의 다른 접촉 법선과 서로 반대쪽이다(공끼리 짝이면 두 공 모두에서, elementWorld.ts
  // pinchedContacts). 그러면 반발 두 단계를 쓰지 않고 이력 스프링(pinchedSpringRow)·심만 쓴다
  pinched?: boolean
  // 이력 스프링의 이번 눌림 주기 최대 깊이(m): 앞 하위 단계 행이 낸 peak. 하위 단계마다 PINCH_RECOVERY_SPEED·h만큼, 지금
  // 깊이까지만 줄어들고(모양을 되찾음) 떨어질 때 주기를 마친다
  peak?: number
  // 앞 하위 단계의 이 짝의 깊이(m, −분리), 그때 짝이 없었으면 undefined. 눌림 주기는 깊어지는 것을 본 때만 시작한다
  previous?: number
  // 심 행(δ ≥ coreDepth)을 붙드는 것이 없다: 이 행의 공을 반대쪽에서 누르는 단단한 것(로봇·정적 형상, 그런 것에 받쳐진 공:
  // elementWorld.ts heldContacts)이 없고, 실행의 첫 하위 단계부터 심 이상 겹친 짝(startCrush)도 아니다. 그러면 심 행은 강체로
  // 버티지 않고 눌린 모양을 되찾는다(coreRecoveryRow)
  free?: boolean
  // 넘겨받은 peak가 눌린 최대 깊이가 아니라 심에서 되찾기를 시작하며 다시 잡은 값이다(앞 하위 단계 행의 restoring)
  restoring?: boolean
}

export type NormalRow = {
  target: number
  // 순응 γ(0 = 강체 행)
  compliance: number
  crushed: boolean
  bounced: boolean
  // 이 하위 단계에 표면까지 와서 멈추게 한 접근 속도(다음 하위 단계가 반발에 쓴다), 아니면 undefined
  arrival?: number
  // 이력 스프링 행이면 다음 하위 단계에 넘길 최대 깊이(떨어졌으면 undefined)
  peak?: number
  // 그 peak가 심에서 되찾기를 시작하며 다시 잡은 값이고 아직 풀림 선 위다(다음 하위 단계에 넘긴다)
  restoring?: true
}

// 법선 행의 목표와 순응(spec-6a §2.3).
// - 반발 두 단계[결정: spec-6a의 한 행 투기 반발 e·(−v_n*) − (1 + e)·분리/h는 속도에 위치 보정을 섞어, 닿기 전 하위 단계에 접근
//   속도를 깎고 다음 하위 단계가 그 깎인 속도로 반발해 0.5 m 낙하가 e² 대신 약 0.03배만 튀었다]: 접근이 문턱보다 빠르고 이 하위
//   단계에 표면에 닿으면(분리 > 0) 강체 행으로 표면까지만 오게 하고(목표 −분리/h) 그 접근 속도를 적어 둔다(arrival). 다음 하위
//   단계(impact)나 이미 닿은 채 빠르게 다가오면(분리 ≤ 0) 강체 목표 e·(−접근 속도)로 튄다. 위치·속도 모두 맞고 표면에 한 하위
//   단계(1 ms) 머문다.
// - 침투 δ > 0: ODE ERP·CFM 꼴의 암시 스프링–감쇠(목표 = (h·k/(h·k + c))·δ/h, γ = 1/(h·(h·k + c)), 정지 상태 힘 = k·δ).
// - 떨어짐(분리 ≥ 0): 예측 목표 −분리/h에 같은 γ.
// - 심(δ ≥ coreDepth): 강체(γ = 0, 목표 0, 밀어내지 않음). 붙드는 것이 없으면(free) 아래의 되찾기다.
// - 끼인 행(pinched)은 반발 두 단계를 쓰지 않는다[결정: 6a 리뷰. 로봇과 벽 사이에 끼인 공의 두 행이 모두 강체 반발 목표(로봇 쪽
//   e·1.5 m/s, 벽 쪽 e·공 속도)를 가지면 LCP가 두 목표를 함께 맞추려고 13.6 kg 로봇을 1 ms에 거꾸로 밀었다(공 25 g이 트램펄린이
//   됨, 들어온 15 J에서 약 11 J가 돌아감). 끼인 공이 돌려줄 수 있는 에너지는 공 자신의 변형(심까지 약 0.7 J)뿐이라 이력 스프링
//   (pinchedSpringRow)과 심이 그것을 낸다. 한쪽이 자유로운 행의 반발(바닥·벽에 튐, 로봇이 쳐 냄)은 그대로다]. 이력 스프링 주기
//   (peak)에 들어간 행은 끼임이 풀려도 떨어질 때까지 이력 스프링이다(중간에 탄성선으로 바꾸면 힘이 뛰어 눌린 깊이만큼 튀어
//   오른다). 하위 단계마다 peak를 PINCH_RECOVERY_SPEED·h만큼, 지금 깊이까지만 줄여 공이 모양을 천천히 되찾게 한다(풀림 선의 쉼
//   깊이 peak·(1 − e²)가 줄어 peak가 깊이에 닿으면 탄성선이다)[가정: elementData.ts PINCH_RECOVERY_SPEED. 6a 최종 확인: 줄이지
//   않으면 바닥에 눌렸다 놓인 공이나 쐐기에 걸친 공처럼 떨어지지 않는 행이 쉼 깊이에 박힌 채 남았다].
// - 붙드는 것이 없는 심 행(free)은 강체로 버티지 않고 눌린 모양을 되찾는다(coreRecoveryRow)[결정: 6a 리뷰 3. 누르던 몸체가 떠난
//   뒤에도 심 행(목표 0)이 밀어내지 않아 공이 심 깊이에 박힌 채 잠들었다]. 붙들린 심 행(끼인 공을 누르는 로봇이 아직 닿아 있음,
//   시작부터 심 이상 겹친 짝)은 그대로 강체다(누르고 있는 몸체에 에너지를 돌려주지 않는다).
export function normalRow(input: NormalRowInput): NormalRow {
  const { separation, approach, h, coreDepth, restitution: e } = input
  const pinched = input.pinched === true
  const peak =
    input.peak === undefined
      ? undefined
      : Math.max(input.peak - PINCH_RECOVERY_SPEED * h, -separation)
  const hysteresis = pinched || peak !== undefined
  if (!hysteresis) {
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
  }
  const depth = -separation
  if (depth >= coreDepth) {
    if (input.free === true) return coreRecoveryRow(input, peak)
    const row: NormalRow = { target: 0, compliance: 0, crushed: true, bounced: false }
    if (hysteresis && loading(depth, peak, input.previous)) row.peak = Math.max(peak ?? 0, depth)
    return row
  }
  if (!hysteresis) return springRow(input)
  const row = pinchedSpringRow({ ...input, peak })
  // 심에서 다시 잡은 peak는 풀림 선 위에 있는 동안(peak > 깊이) 그 표시를 이어 간다
  if (input.restoring === true && row.peak !== undefined && row.peak > depth) row.restoring = true
  return row
}

// 붙드는 것이 없는 심 행의 되찾기(6a 리뷰 3). 심까지 눌린 공은 변형 에너지를 잃었다(심 넘는 충돌은 소성: 심 행이 몸체를 멈추고
// 돌려주지 않는다). 그래서 풀린 행은 눌린 최대 깊이의 탄성 힘 k·δ(POLLEN 약 64 N: 25 g 공이 약 1.6 m/s로 튀어 나간다)를 쓰지
// 않고, 이력 스프링의 쉼 깊이 δ₀ = peak·(1 − e²)를 지금 깊이로 다시 잡는다(peak = δ/(1 − e²), 그 순간 힘 0). 그 뒤는 보통의 이력
// 스프링 되찾기다: peak가 하위 단계마다 PINCH_RECOVERY_SPEED·h만큼 줄어 쉼 깊이가 PINCH_RECOVERY_SPEED·(1 − e²)로 물러나고,
// 풀림 선 F = k_U·(δ − δ₀)(pinchedSpringRow)이 공을 그 쉼 깊이에 붙여 민다. 심 아래로 나와도 같은 선이라 힘이 뛰지 않고, peak가
// 깊이에 닿으면 탄성선이다(공은 탄성 평형 mg/k에서 끝난다). 다시 잡은 peak는 restoring으로 표시해 넘긴다: 눌린 최대 깊이로
// 넘겨받은 peak와 가르지 않으면 무게에 눌려 심 깊이로 되돌아온 행이 쉼 깊이를 매번 다시 잡아 나오지 못한다. 행은 순응이 있는
// 스프링이라(강체가 아니다) 받치는 것 없는 공들만 민다: 누르는 로봇·정적 형상이 닿아 있으면 free가 아니다(elementWorld.ts
// heldContacts)[결정: 강체 행으로 PINCH_RECOVERY_SPEED만큼 벌리면(검토한 다른 길) 무게에 눌린 공이 심 경계에서 강체 행과 풀림
// 선을 오갔다. 풀림 선 하나면 심 위아래가 같은 식이다]
function coreRecoveryRow(input: NormalRowInput, peak: number | undefined): NormalRow {
  const depth = -input.separation
  const carried = input.restoring === true && peak !== undefined && peak > depth
  // e → 1이면 잃는 것이 없어 쉼 깊이를 깊이에 둘 수 없다(나눗셈 0): 잃는 비의 하한을 둔다(그때는 탄성선에 가까워 튀어 나간다)
  const loss = Math.max(1 - returnRatio(input.restitution), MIN_PINCH_RETURN)
  const row = pinchedSpringRow({ ...input, peak: carried ? peak : depth / loss })
  return { ...row, crushed: true, restoring: true }
}

// 눌림 주기를 이어 가거나 새로 시작하는지: 이미 주기 안이거나, 앞 하위 단계에 이 짝이 있었고 지금 더 깊다(눌리는 것을 봤다)
// [결정: 6a 최종 확인. 시작 겹침(첫 하위 단계)이나 잠에서 깬 공처럼 이미 겹친 채 처음 나온 짝은 눌린 이력이 아니다. 그 겹침을
// peak로 적으면 벌어진 두 면(쐐기) 사이 프리로드가 쉼 깊이 peak·(1 − e²)에 박힌 채 남아 INIT 겹침 결과('밀려납니다')와 달랐다]
function loading(depth: number, peak: number | undefined, previous: number | undefined): boolean {
  return peak !== undefined || (previous !== undefined && depth > previous)
}

// 끼인 공의 이력 스프링(Walton–Braun 선형 이력 모델[가정: 끼인 공의 되돌림 에너지 비 = e²]): 눌릴 때(깊이가 이번 주기 최대
// peak 이상) 탄성선 F = k·δ(springRow)이고, 풀릴 때(δ < peak) 더 가파른 선 F = k_U·(δ − δ₀), k_U = k/e², δ₀ = peak·(1 − e²)
// (peak에서 두 선의 힘이 같다)라 한 주기에 변형 에너지의 e²만 돌려준다. 그래서 무거운 몸체가 공을 면에 눌렀다 놓아도 몸체 질량과
// 관계없이 공의 반발 계수 e 안팎으로 되튄다[결정: 6a 리뷰. 감쇠 c = 2ζ√(k·m)은 공 질량 기준이라 13.6 kg 판에는 유효 감쇠비가
// 약 0.03이어서 판이 0.89배로 되튀었다(변형 에너지의 79 %)]. 감쇠 c는 탄성선 그대로(k로 낸 값)다. δ < δ₀이면 힘이 없고 δ₀까지
// 예측 목표다. 떨어지면(δ ≤ 0) 주기가 끝나 peak를 버린다. 주기 밖의 행은 깊어지는 것을 볼 때(loading) 주기를 시작한다(그 전에는
// 탄성선)
export function pinchedSpringRow(
  input: Pick<
    NormalRowInput,
    'separation' | 'h' | 'stiffness' | 'mass' | 'dampingRatio' | 'restitution' | 'peak' | 'previous'
  >
): NormalRow {
  const depth = -input.separation
  const peak = input.peak
  if (depth <= 0 || peak === undefined || depth >= peak) {
    const row = springRow(input)
    if (depth > 0 && loading(depth, peak, input.previous)) row.peak = depth
    return row
  }
  const { h, stiffness: k, mass } = input
  const ratio = returnRatio(input.restitution)
  const unload = k / ratio
  const rest = peak * (1 - ratio)
  const c = 2 * input.dampingRatio * Math.sqrt(k * mass)
  const compliance = 1 / (h * (h * unload + c))
  if (depth > rest)
    return {
      target: (unload * (depth - rest)) / (h * unload + c),
      compliance,
      crushed: false,
      bounced: false,
      peak
    }
  return { target: -(rest - depth) / h, compliance, crushed: false, bounced: false, peak }
}

// 이력 스프링의 되돌림 에너지 비 e²의 하한[결정: e = 0이면 k_U가 무한대다. 0.01은 e = 0.1, 쓰는 반발 계수(0.3 이상)보다 작다]
export const MIN_PINCH_RETURN = 0.01

// 이력 스프링의 되돌림 에너지 비(e²를 [MIN_PINCH_RETURN, 1]로 자른 값)
const returnRatio = (restitution: number): number =>
  Math.min(1, Math.max(MIN_PINCH_RETURN, restitution * restitution))

// 부드러운 법선(심·반발 없는 스프링–감쇠) 행: 침투 δ > 0이면 목표 (h·k/(h·k + c))·δ/h, 떨어져 있으면 예측 목표 −분리/h, 둘 다
// 순응 γ = 1/(h·(h·k + c)). normalRow의 심 아래 경우이고, 로봇·넣은 공을 정해진 속도로 보는 한쪽 행(elementWorld.ts
// softenOneWay)도 쓴다
export function springRow(
  input: Pick<NormalRowInput, 'separation' | 'h' | 'stiffness' | 'mass' | 'dampingRatio'>
): NormalRow {
  const { separation, h, stiffness: k, mass } = input
  const depth = -separation
  const c = 2 * input.dampingRatio * Math.sqrt(k * mass)
  const compliance = 1 / (h * (h * k + c))
  if (depth > 0)
    return { target: (k * depth) / (h * k + c), compliance, crushed: false, bounced: false }
  return { target: -separation / h, compliance, crushed: false, bounced: false }
}
