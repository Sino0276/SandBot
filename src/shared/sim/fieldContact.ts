import type { ContactRow } from './articulation'
import { perpendicular, WALL_MARGIN } from './contact'
import type { FieldSpec } from './seasons/fieldSpec'
import { placeFootprint, solidFootprints, type SolidFootprint } from './seasons/fieldGeometry'
import type { Pose2, Vec2 } from './worldSpec'

// 고정 경기 요소 접촉(spec-4ab §1.10, 순수·결정적, 배열 순서만 쓴다). 부유 기저(바퀴가 있는 로봇)의 외곽 × [0, H] 프리즘과
// 시즌의 solid 구조물(carrier 'field', [0, H] 단면을 위에서 본 볼록 껍질 또는 세운 원기둥)의 접촉 행을 만든다. world.ts의
// contacts()가 벽 행 뒤에 붙이고, 행은 벽과 같은 모양이다(법선 한쪽 행 + 접선 마찰 상자, 반발 0, 위치 자르기 없음, 목표
// −max(gap, 0)/h라 시작부터 겹친 로봇을 밀어내지 않는다). 구조물 힘은 바닥 높이에 작용한다고 본다(하중 이동 없음, 벽과 같은 한계).
//
// 좁은 단계(볼록 다각형–다각형): SAT로 두 다각형의 분리 축 후보(구조물 면 i*, 로봇 면 j*)를 고르고, 기준 면 하나에 다른
// 다각형의 사건 변을 잘라 점 2개까지 낸다(Box2D b2CollidePolygons와 같은 꼴). 기준 면은 하위 단계 사이 히스테리시스로 고정해
// 모서리 대 모서리에서 법선이 뒤집히지 않게 하고, 행 키에 기준 면을 넣어 법선이 바뀌면 키도 바뀌게 한다(앞 하위 단계의 같은 키
// 충격·LCP 활성 집합을 다른 법선에 쓰지 않게, Box2D 특징 id와 같은 뜻).

// 기준 면 히스테리시스(m): 로봇 면 분리가 구조물 면 분리보다 이만큼 커야 로봇 면을 기준으로 한다. [결정: Box2D
// b2CollidePolygons의 k_tol = 0.1·b2_linearSlop(0.005 m) = 5e-4 m. 필드에 고정된 구조물 법선을 먼저 써서 하위 단계마다 기준이
// 뒤집히지 않게]
export const REFERENCE_TOLERANCE = 5e-4

// 생성자에서 한 번 만드는 접촉 준비(시즌·로봇 높이마다 같다)
export type FieldCollision = {
  // 벽 접촉 기준면 반폭(FieldSpec.perimeter.innerHalf)
  innerHalf: number
  // solid이고 carrier 'field'인 구조물 중 [0, height]와 높이가 겹치는 것(solidFootprints 그대로, structures 순서)
  solids: SolidFootprint[]
  // solids[k]의 접선 μ(field.structures[solids[k].index].friction)
  friction: number[]
  // 다각형 solids[k]의 변 i(점 i → i + 1) 바깥 법선(원기둥은 null)
  normals: (Vec2[] | null)[]
  // field.structures 길이(히스테리시스 기억의 길이)
  structureCount: number
}

// 구조물마다 앞 하위 단계의 기준 면: 'q'는 구조물 껍질 면, 'p'는 로봇 외곽 면. 접촉이 없으면 null
export type ContactReference = { side: 'q' | 'p'; face: number }
export type StructureContactState = { reference: (ContactReference | null)[] }

// 반시계 다각형 변 i(점 i → i + 1)의 바깥 법선
function edgeNormals(points: readonly Vec2[]): Vec2[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const length = Math.hypot(dx, dy)
    return { x: dy / length, y: -dx / length }
  })
}

export function fieldCollision(field: FieldSpec, height: number): FieldCollision {
  const solids = solidFootprints(field, height)
  return {
    innerHalf: field.perimeter.innerHalf,
    solids,
    friction: solids.map((s) => field.structures[s.index].friction),
    normals: solids.map((s) => (s.kind === 'polygon' ? edgeNormals(s.points) : null)),
    structureCount: field.structures.length
  }
}

export function structureContactState(collision: FieldCollision): StructureContactState {
  return { reference: new Array<ContactReference | null>(collision.structureCount).fill(null) }
}

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })

// 접촉 점 하나: 필드 좌표 점, 행 법선(로봇을 구조물에서 밀어내는 쪽, 필드 축), 간격(양수면 떨어짐), 특징 키, 법선이 로봇에 붙어
// 도는지(로봇 면이 기준: 아래 곡률 보정)
type ContactPoint = {
  point: Vec2
  normal: Vec2
  gap: number
  feature: string
  robotNormal: boolean
}

// 다각형 a의 각 변 i 분리 min_k n_i·(b_k − a_i)(변 순번 순)
function faceSeparations(
  a: readonly Vec2[],
  normals: readonly Vec2[],
  b: readonly Vec2[]
): number[] {
  return a.map((p, i) => {
    let least = Infinity
    for (const v of b) least = Math.min(least, dot(normals[i], sub(v, p)))
    return least
  })
}

// 가장 큰 분리의 변(같으면 작은 번호)
function maxFace(separations: readonly number[]): number {
  let best = 0
  for (let i = 1; i < separations.length; i++) if (separations[i] > separations[best]) best = i
  return best
}

// 사건 변: 법선과 기준 법선의 내적이 가장 작은 변(같으면 작은 번호)
function incidentFace(normals: readonly Vec2[], reference: Vec2): number {
  let best = 0
  let least = dot(normals[0], reference)
  for (let i = 1; i < normals.length; i++) {
    const d = dot(normals[i], reference)
    if (d < least) {
      least = d
      best = i
    }
  }
  return best
}

// 선분 끝점(다각형 꼭짓점 번호를 가진다)
type ClipPoint = { p: Vec2; k: number }

// 선분 [a, b]를 반평면 d(x) ≥ 0으로 자른다. 밖에 있던 끝점은 교점으로 바뀌되 그 끝점의 꼭짓점 번호를 그대로 갖는다. 둘 다
// 밖이면 null
function clipSegment(
  a: ClipPoint,
  b: ClipPoint,
  d: (p: Vec2) => number
): [ClipPoint, ClipPoint] | null {
  const da = d(a.p)
  const db = d(b.p)
  if (da < 0 && db < 0) return null
  const at = (t: number): Vec2 => ({
    x: a.p.x + t * (b.p.x - a.p.x),
    y: a.p.y + t * (b.p.y - a.p.y)
  })
  if (da < 0) return [{ p: at(da / (da - db)), k: a.k }, b]
  if (db < 0) return [a, { p: at(da / (da - db)), k: b.k }]
  return [a, b]
}

// 볼록 다각형 둘(필드 좌표, 반시계): 구조물 껍질 q(법선 nq)와 로봇 외곽 p(법선 np). 접촉이 없으면 null(기억도 null로)
function polygonContact(
  q: readonly Vec2[],
  nq: readonly Vec2[],
  p: readonly Vec2[],
  np: readonly Vec2[],
  margin: number,
  previous: ContactReference | null
): { points: ContactPoint[]; reference: ContactReference } | null {
  const sepQs = faceSeparations(q, nq, p)
  const sepPs = faceSeparations(p, np, q)
  let iStar = maxFace(sepQs)
  let jStar = maxFace(sepPs)
  const sepQ = sepQs[iStar]
  const sepP = sepPs[jStar]
  if (Math.max(sepQ, sepP) > margin) return null
  // 히스테리시스: 앞 기준 면이 지금 최대에서 REFERENCE_TOLERANCE 안이면 그 면을 유지한다
  if (previous?.side === 'q' && sepQs[previous.face] >= sepQ - REFERENCE_TOLERANCE)
    iStar = previous.face
  if (previous?.side === 'p' && sepPs[previous.face] >= sepP - REFERENCE_TOLERANCE)
    jStar = previous.face
  // 기준 면: 로봇 면 분리가 구조물 면 분리보다 REFERENCE_TOLERANCE 넘게 클 때만 로봇 면(앞 기준이 로봇 면이었으면 −TOL까지 유지)
  const robotFace =
    previous?.side === 'p' ? sepP > sepQ - REFERENCE_TOLERANCE : sepP > sepQ + REFERENCE_TOLERANCE
  const reference: ContactReference = robotFace
    ? { side: 'p', face: jStar }
    : { side: 'q', face: iStar }
  // 기준 다각형 r(면 f), 사건 다각형 s
  const [r, s, nr, ns] = robotFace ? [p, q, np, nq] : [q, p, nq, np]
  const f = reference.face
  const v1 = r[f]
  const v2 = r[(f + 1) % r.length]
  const nRef = nr[f]
  const e = incidentFace(ns, nRef)
  const e1 = (e + 1) % s.length
  // 기준 면의 양 끝 옆면 τ·x ≥ τ·v1, τ·x ≤ τ·v2로 자른다
  const length = Math.hypot(v2.x - v1.x, v2.y - v1.y)
  const tau = { x: (v2.x - v1.x) / length, y: (v2.y - v1.y) / length }
  const lo = dot(tau, v1)
  const hi = dot(tau, v2)
  const first = clipSegment({ p: s[e], k: e }, { p: s[e1], k: e1 }, (x) => dot(tau, x) - lo)
  const clipped = first && clipSegment(first[0], first[1], (x) => hi - dot(tau, x))
  const points: ContactPoint[] = []
  if (clipped)
    for (const c of clipped) {
      const gap = dot(nRef, sub(c.p, v1))
      points.push(
        robotFace
          ? // (b) 로봇 면이 기준: 점은 구조물 껍질 변 위, 행 법선은 −n'_j(필드 틀, 다시 돌리지 않는다)
            {
              point: c.p,
              normal: { x: -nRef.x, y: -nRef.y },
              gap,
              feature: `p${f}.c${c.k}`,
              robotNormal: true
            }
          : // (a) 구조물 면이 기준: 점은 로봇 변 위, 행 법선은 구조물 바깥 법선 n_i*(필드 고정)
            { point: c.p, normal: nRef, gap, feature: `q${f}.r${c.k}`, robotNormal: false }
      )
    }
  return { points, reference }
}

// 세운 원기둥(중심 c, 반지름 ρ)과 로봇 외곽 p(법선 np). Box2D b2CollidePolygonAndCircle과 같은 꼴, 히스테리시스 없음
function circleContact(
  center: Vec2,
  radius: number,
  p: readonly Vec2[],
  np: readonly Vec2[],
  margin: number
): ContactPoint[] | null {
  let j = 0
  let best = -Infinity
  p.forEach((v, i) => {
    const d = dot(np[i], sub(center, v))
    if (d > best) {
      best = d
      j = i
    }
  })
  if (best > radius + margin) return null
  const face = (): ContactPoint[] => {
    const n = np[j]
    return [
      {
        point: { x: center.x - radius * n.x, y: center.y - radius * n.y },
        normal: { x: -n.x, y: -n.y },
        gap: best - radius,
        feature: `p${j}.c0`,
        robotNormal: true
      }
    ]
  }
  // 중심이 외곽 안이면 변 접촉
  if (best < 0) return face()
  const k1 = (j + 1) % p.length
  const v1 = p[j]
  const v2 = p[k1]
  const u1 = dot(sub(center, v1), sub(v2, v1))
  const u2 = dot(sub(center, v2), sub(v1, v2))
  const vertex = u1 <= 0 ? j : u2 <= 0 ? k1 : -1
  if (vertex < 0) return face()
  const corner = p[vertex]
  const distance = Math.hypot(corner.x - center.x, corner.y - center.y)
  if (distance === 0) return face()
  if (distance - radius > margin) return null
  return [
    {
      point: corner,
      normal: { x: (corner.x - center.x) / distance, y: (corner.y - center.y) / distance },
      gap: distance - radius,
      feature: `q0.r${vertex}`,
      robotNormal: false
    }
  ]
}

// 구조물 행: 구조물은 structures 순번 순, 한 구조물 안의 점은 사건 변 끝점 순(자른 뒤 남은 것), 점마다 n행 다음 t행(벽과 같음).
// 키는 n|t + s<구조물 순번>.<특징>(특징 q<구조물 면>.r<로봇 꼭짓점> 또는 p<로봇 면>.c<껍질 꼭짓점>). state는 PhysicsWorld가
// 갖는 기준 면 기억이고 이 함수가 갱신한다.
export function structureRows(
  collision: FieldCollision,
  footprint: readonly Vec2[],
  pose: Pose2,
  velocity: { vx: number; vy: number; omega: number },
  h: number,
  m: number,
  state: StructureContactState
): ContactRow[] {
  const rows: ContactRow[] = []
  if (collision.solids.length === 0) return rows
  const placed = placeFootprint(footprint, pose)
  const normals = edgeNormals(placed)
  // 넓은 단계 여유 e = (|v| + |ω|·r_max)·h + WALL_MARGIN
  let rMax = 0
  for (const v of placed) rMax = Math.max(rMax, Math.hypot(v.x - pose.x, v.y - pose.y))
  const margin =
    (Math.hypot(velocity.vx, velocity.vy) + Math.abs(velocity.omega) * rMax) * h + WALL_MARGIN
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of placed) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  collision.solids.forEach((solid, k) => {
    const index = solid.index
    if (
      solid.min.x > maxX + margin ||
      solid.max.x < minX - margin ||
      solid.min.y > maxY + margin ||
      solid.max.y < minY - margin
    ) {
      state.reference[index] = null
      return
    }
    let points: ContactPoint[] | null
    if (solid.kind === 'polygon') {
      const found = polygonContact(
        solid.points,
        collision.normals[k] as Vec2[],
        placed,
        normals,
        margin,
        state.reference[index]
      )
      state.reference[index] = found ? found.reference : null
      points = found ? found.points : null
    } else {
      points = circleContact(solid.center, solid.radius, placed, normals, margin)
    }
    if (!points) return
    const mu = collision.friction[k]
    for (const c of points) {
      const r = { x: c.point.x - pose.x, y: c.point.y - pose.y }
      // 접근 속도 n·(v + ω × r)(wallRows와 같은 식)
      const speed =
        c.normal.x * (velocity.vx - velocity.omega * r.y) +
        c.normal.y * (velocity.vy + velocity.omega * r.x)
      if (c.gap > Math.abs(speed) * h + WALL_MARGIN) continue
      // 곡률 보정: 행은 이번 자세에서 선형화한 J·v⁺ ≥ −max(gap, 0)/h이고 위치는 h·v⁺로 나아가므로, 간격의 2차 항 (h²/2)·g̈만큼
      // 하위 단계마다 어긋난다. 로봇 면이 기준이면(법선이 로봇과 함께 돈다) 고정 점까지의 간격이 g̈ = ω²·(n·r) + 2ω·(t·v)로
      // 줄어(n·r < 0: 점이 원점보다 구조물 쪽) 도는 로봇이 꼭짓점·원기둥을 하위 단계마다 ω²·|n·r|·h²/2씩 파고든다(전출력 제자리
      // 회전에서 약 1 µm). 구조물 면이 기준이면 g̈ = −ω²·(n·r) ≥ 0이라 모서리가 면에서 멀어진다(벽과 같음). 그래서 지금
      // 속도로 낸 g̈가 음수일 때만 목표를 (h/2)·|g̈|만큼 조인다(풀지 않는다). 정지·병진만이면 0이라 걸친 시작을 밀어내지 않는다.
      // [결정: 명세(§1.10) 밖에서 더한 보정. 지금 속도로 낸 값이라 각가속이 큰 하위 단계에는 µm 단위가 남을 수 있고, 도는 로봇은
      // 꼭짓점 앞에서 그만큼 일찍 멈춘다. 벽 행·구조물 면 기준에는 없다. CLAUDE.md 4ab 한계]
      const t = perpendicular(c.normal)
      const nr = c.normal.x * r.x + c.normal.y * r.y
      const omega = velocity.omega
      const curvature = c.robotNormal
        ? omega * omega * nr + 2 * omega * (t.x * velocity.vx + t.y * velocity.vy)
        : -omega * omega * nr
      const tighten = (Math.max(0, -curvature) * h) / 2
      const row = (d: Vec2): number[] => {
        const j = new Array<number>(m).fill(0)
        j[0] = d.x
        j[1] = d.y
        j[2] = -d.x * r.y + d.y * r.x
        return j
      }
      const key = `s${index}.${c.feature}`
      rows.push({
        key: `n${key}`,
        j: row(c.normal),
        target: -Math.max(c.gap, 0) / h + tighten,
        lo: 0,
        hi: Infinity
      })
      rows.push({
        key: `t${key}`,
        j: row(t),
        target: 0,
        lo: 0,
        hi: 0,
        friction: { normal: `n${key}`, mu }
      })
    }
  })
  return rows
}
