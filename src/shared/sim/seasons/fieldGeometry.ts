import type { Pose2, Vec2, Vec3 } from '../worldSpec'
import type { FieldRect, FieldShape, FieldSpec } from './fieldSpec'

// 필드 요소의 평면 기하(spec-4ab §1.8, 순수·결정적, 배열 순서만 쓴다). 4a의 시작 겹침 판정과 4b의 구조물 접촉이 같이 쓴다.
// 로봇은 "외곽 × [0, H]" 프리즘이고, 구조물은 그 높이 슬랩으로 자른 단면을 위에서 본 볼록 껍질로 다룬다.

type BoxShape = Extract<FieldShape, { kind: 'box' }>

// ---- 회전(ZYX, R = Rz·Ry·Rx, 3×3 행 우선) ----

export function matMul3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return out
}

// Three.js Euler 'ZYX'와 같은 행렬
export function rotationMatrix(rotation: Vec3): number[] {
  const ca = Math.cos(rotation.x)
  const sa = Math.sin(rotation.x)
  const cb = Math.cos(rotation.y)
  const sb = Math.sin(rotation.y)
  const cc = Math.cos(rotation.z)
  const sc = Math.sin(rotation.z)
  const rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca]
  const ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb]
  const rz = [cc, -sc, 0, sc, cc, 0, 0, 0, 1]
  return matMul3(rz, matMul3(ry, rx))
}

export function applyMatrix3(m: readonly number[], v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z
  }
}

// 상자의 8꼭짓점(carrier 틀). 순번 k의 비트 0·1·2가 자기 x·y·z의 +쪽이다(모서리 = 비트 하나만 다른 쌍)
export function boxVertices(shape: BoxShape): Vec3[] {
  const m = rotationMatrix(shape.rotation)
  const vertices: Vec3[] = []
  for (let k = 0; k < 8; k++) {
    const local = {
      x: ((k & 1 ? 1 : -1) * shape.size.x) / 2,
      y: ((k & 2 ? 1 : -1) * shape.size.y) / 2,
      z: ((k & 4 ? 1 : -1) * shape.size.z) / 2
    }
    const r = applyMatrix3(m, local)
    vertices.push({ x: shape.center.x + r.x, y: shape.center.y + r.y, z: shape.center.z + r.z })
  }
  return vertices
}

// 축 정렬 사각형의 반시계 다각형((x0, y0)부터)
export function rectPolygon([x0, y0, x1, y1]: FieldRect): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 }
  ]
}

// ---- 볼록 껍질·높이 ----

// 일직선 판정(m²): 이보다 작은 외적은 일직선으로 보고 뺀다
const COLLINEAR = 1e-12

const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

// Andrew monotone chain. 반시계, (x, y) 사전순 최소점에서 시작, 일직선 점(cross ≤ 1e-12)은 뺀다. 점이 셋 미만이면 []
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = points.map((p) => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y)
  const unique: Vec2[] = []
  for (const p of sorted) {
    const last = unique[unique.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) unique.push(p)
  }
  if (unique.length < 3) return []
  const lower: Vec2[] = []
  for (const p of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= COLLINEAR
    )
      lower.pop()
    lower.push(p)
  }
  const upper: Vec2[] = []
  for (let k = unique.length - 1; k >= 0; k--) {
    const p = unique[k]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= COLLINEAR
    )
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  const hull = lower.concat(upper)
  return hull.length >= 3 ? hull : []
}

// 높이 겹침은 열린 구간: zMin < h1 && zMax > h0일 때만 겹친다(맞닿기만 하면 아님). 4b 접촉과 같은 규칙
export function heightOverlaps(zMin: number, zMax: number, h0: number, h1: number): boolean {
  return zMin < h1 && zMax > h0
}

// 상자 ∩ {zMin ≤ z ≤ zMax}의 위에서 본 볼록 껍질(필드 좌표, convexHull 순서). 높이가 겹치지 않으면 null
//   점 = 슬랩 안의 상자 꼭짓점 + 상자 모서리 12개와 z = zMin·zMax 평면의 교점
// (크기가 양수인 상자는 단면이 늘 넓이를 가진다. 수치로 껍질이 비면 null)
export function boxSlabHull(shape: BoxShape, zMin: number, zMax: number): Vec2[] | null {
  const vertices = boxVertices(shape)
  const zs = vertices.map((v) => v.z)
  if (!heightOverlaps(Math.min(...zs), Math.max(...zs), zMin, zMax)) return null
  const points: Vec2[] = []
  for (const v of vertices) if (v.z >= zMin && v.z <= zMax) points.push({ x: v.x, y: v.y })
  for (let i = 0; i < 8; i++)
    for (const bit of [1, 2, 4]) {
      const j = i | bit
      if (j === i) continue
      const a = vertices[i]
      const b = vertices[j]
      for (const z0 of [zMin, zMax]) {
        if ((a.z - z0) * (b.z - z0) >= 0) continue
        const t = (z0 - a.z) / (b.z - a.z)
        points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
      }
    }
  const hull = convexHull(points)
  return hull.length >= 3 ? hull : null
}

// ---- solid 구조물의 평면 단면 ----

export type SolidFootprint =
  // index = structures 순번
  | { index: number; kind: 'polygon'; points: Vec2[]; min: Vec2; max: Vec2 }
  | { index: number; kind: 'circle'; center: Vec2; radius: number; min: Vec2; max: Vec2 }

// solid이고 carrier 'field'인 구조물 중 [0, height]와 높이가 겹치는 것(structures 순서). 높이 규칙은 heightOverlaps 하나
export function solidFootprints(spec: FieldSpec, height: number): SolidFootprint[] {
  const out: SolidFootprint[] = []
  spec.structures.forEach((s, index) => {
    if (!s.solid || s.carrier !== 'field') return
    const shape = s.shape
    if (shape.kind === 'box') {
      const points = boxSlabHull(shape, 0, height)
      if (!points) return
      const xs = points.map((p) => p.x)
      const ys = points.map((p) => p.y)
      out.push({
        index,
        kind: 'polygon',
        points,
        min: { x: Math.min(...xs), y: Math.min(...ys) },
        max: { x: Math.max(...xs), y: Math.max(...ys) }
      })
      return
    }
    // 세운 원기둥(rotation x·y = 0, checkFieldSpec): Z 구간은 중심 ± 높이/2
    const half = shape.height / 2
    if (!heightOverlaps(shape.center.z - half, shape.center.z + half, 0, height)) return
    const { x, y } = shape.center
    const r = shape.radius
    out.push({
      index,
      kind: 'circle',
      center: { x, y },
      radius: r,
      min: { x: x - r, y: y - r },
      max: { x: x + r, y: y + r }
    })
  })
  return out
}

// 로봇 외곽(로봇 좌표)을 필드 좌표로: R(yaw)·v + (x, y)
export function placeFootprint(footprint: readonly Vec2[], pose: Pose2): Vec2[] {
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  return footprint.map((v) => ({ x: c * v.x - s * v.y + pose.x, y: s * v.x + c * v.y + pose.y }))
}

// ---- 분리 거리(SAT) ----

// 다각형 a의 변마다 바깥 법선으로 b의 가장 안쪽 꼭짓점까지의 거리, 그 최댓값
function edgeSeparation(a: readonly Vec2[], b: readonly Vec2[]): number {
  let best = -Infinity
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = a[(i + 1) % a.length]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const length = Math.hypot(dx, dy)
    if (length === 0) continue
    // 반시계 다각형 변의 바깥 법선
    const nx = dy / length
    const ny = -dx / length
    let least = Infinity
    for (const v of b) least = Math.min(least, nx * (v.x - p.x) + ny * (v.y - p.y))
    best = Math.max(best, least)
  }
  return best
}

// SAT 분리 거리(음수면 침투 깊이). 볼록 반시계 다각형 둘
export function polygonSeparation(a: readonly Vec2[], b: readonly Vec2[]): number {
  return Math.max(edgeSeparation(a, b), edgeSeparation(b, a))
}

// 원과 볼록 반시계 다각형의 분리 거리(음수면 침투 깊이)
export function circlePolygonSeparation(
  center: Vec2,
  radius: number,
  polygon: readonly Vec2[]
): number {
  let inside = -Infinity
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    const length = Math.hypot(q.x - p.x, q.y - p.y)
    if (length === 0) continue
    const nx = (q.y - p.y) / length
    const ny = -(q.x - p.x) / length
    inside = Math.max(inside, nx * (center.x - p.x) + ny * (center.y - p.y))
  }
  // 중심이 다각형 안: 가장 가까운 변 직선까지(음수)
  if (inside <= 0) return inside - radius
  // 밖: 가장 가까운 변(선분)까지
  let distance = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const lengthSq = dx * dx + dy * dy
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((center.x - p.x) * dx + (center.y - p.y) * dy) / lengthSq))
    distance = Math.min(distance, Math.hypot(center.x - (p.x + t * dx), center.y - (p.y + t * dy)))
  }
  return distance - radius
}

// ---- 시작 겹침 ----

export type FieldOverlap =
  { kind: 'wall'; wall: 'x+' | 'x-' | 'y+' | 'y-' } | { kind: 'structure'; index: number }

// 겹침 허용(m): 프리셋 스냅은 벽에 간격 0으로 닿으므로 반올림만큼은 겹침이 아니다
export const OVERLAP_TOLERANCE = 1e-6

const WALL_CHECKS: readonly { wall: 'x+' | 'x-' | 'y+' | 'y-'; at: (p: Vec2) => number }[] = [
  { wall: 'x+', at: (p) => p.x },
  { wall: 'x-', at: (p) => -p.x },
  { wall: 'y+', at: (p) => p.y },
  { wall: 'y-', at: (p) => -p.y }
]

// 외곽(로봇 좌표)을 자세에 놓았을 때 벽(+x, −x, +y, −y 순서)과 solid 구조물(solidFootprints 순서)의 겹침.
// startKeepOut·구역은 보지 않는다(구역은 startPose.ts startConflicts).
export function fieldOverlaps(
  spec: FieldSpec,
  footprint: readonly Vec2[],
  pose: Pose2,
  height: number
): FieldOverlap[] {
  const placed = placeFootprint(footprint, pose)
  const limit = spec.perimeter.innerHalf + OVERLAP_TOLERANCE
  const out: FieldOverlap[] = []
  for (const { wall, at } of WALL_CHECKS)
    if (placed.some((p) => at(p) > limit)) out.push({ kind: 'wall', wall })
  for (const solid of solidFootprints(spec, height)) {
    const separation =
      solid.kind === 'polygon'
        ? polygonSeparation(placed, solid.points)
        : circlePolygonSeparation(solid.center, solid.radius, placed)
    if (separation < -OVERLAP_TOLERANCE) out.push({ kind: 'structure', index: solid.index })
  }
  return out
}
