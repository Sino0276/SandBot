import { pseudoInverse3 } from './drivetrain'
import type { Vec2 } from './worldSpec'

// 바퀴 법선 하중 분배(3c, 순수·결정적). 바닥이 받쳐야 할 렌치(로봇 좌표 원점 = 로봇 중심 바닥 기준의 수직 힘 F_z와 롤·피치
// 모멘트 M_x·M_y)를 바퀴 접점 하중 N_i ≥ 0으로 나눈다. 시뮬레이터(하위 단계마다)와 인스펙터 바퀴 카드(정적 하중)가 같이 쓴다.
//
// 식: ΣN_i = F_z, Σ y_i·N_i = M_x, −Σ x_i·N_i = M_y(r_i × N_i·ẑ = (y_i·N_i, −x_i·N_i, 0)).
// 바퀴가 넷 이상이면 부정정이다. 같은 강성 스프링(폼 타일) 위의 강체 차대로 보면 처짐이 평면이라 N이 A의 행 공간에 있고,
// 그 해는 최소 노름 해 N = Aᵀ(AAᵀ)⁺d 하나다(method §5.2). 음수 하중은 활성 집합으로 뺀다: 가장 작은 것(같으면 작은
// 순번)을 빼고 다시 푼다(바퀴 수만큼만, 결정적). 뺀 바퀴는 하중 0(뜬다).
//
// ZMP(x = −M_y/F_z, y = M_x/F_z)가 접점의 볼록 껍질 밖이면 N ≥ 0인 해가 없다(실제 로봇은 기운다). 이때는 ZMP를 껍질의 가장
// 가까운 점으로 옮겨 풀고(ΣN = F_z와 N ≥ 0을 지킨다), 옮긴 거리 × F_z를 받쳐지지 않은 모멘트로 돌려준다. 시뮬레이터는
// 평면이라 로봇이 넘어지지 않고, 알림(tipping)만 낸다.

// ZMP가 껍질 안인지 볼 때의 거리 허용(m): 반올림 잡음
const HULL_EPSILON = 1e-9

export type WheelLoads = {
  // 바퀴마다 하중(N, 입력 순서, ≥ 0)
  loads: number[]
  // 받쳐지지 않은 모멘트 크기(N·m, ZMP를 껍질로 옮긴 거리 × F_z). 0이면 받쳐진다.
  unsupported: number
}

const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

// 볼록 껍질(Andrew 단조 사슬, 반시계, 같은 점·일직선 점 제외). 점의 정렬 기준은 x, y, 원래 순번이라 결정적이다.
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = points
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.x - b.p.x || a.p.y - b.p.y || a.i - b.i)
    .map((e) => e.p)
  const unique: Vec2[] = []
  for (const p of sorted) {
    const last = unique[unique.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) unique.push(p)
  }
  if (unique.length <= 2) return unique
  const lower: Vec2[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Vec2[] = []
  for (let k = unique.length - 1; k >= 0; k--) {
    const p = unique[k]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  const hull = lower.concat(upper)
  // 모든 점이 일직선이면 양 끝 두 점만 남는다
  return hull.length >= 2 ? hull : unique.slice(0, 1)
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  if (!(length2 > 0)) return { x: a.x, y: a.y }
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

// 껍질(반시계) 안이면 그 점, 밖이면 가장 가까운 껍질 위의 점
export function closestInHull(hull: readonly Vec2[], p: Vec2): Vec2 {
  if (hull.length === 0) return { x: p.x, y: p.y }
  if (hull.length === 1) return { x: hull[0].x, y: hull[0].y }
  if (hull.length >= 3) {
    let inside = true
    for (let k = 0; k < hull.length; k++) {
      const a = hull[k]
      const b = hull[(k + 1) % hull.length]
      const ex = b.x - a.x
      const ey = b.y - a.y
      // 변 a→b의 왼쪽(안쪽)에서 HULL_EPSILON보다 바깥이면 밖
      if (cross(a, b, p) < -HULL_EPSILON * Math.sqrt(ex * ex + ey * ey)) {
        inside = false
        break
      }
    }
    if (inside) return { x: p.x, y: p.y }
  }
  let best: Vec2 = hull[0]
  let bestDistance = Infinity
  const edges = hull.length === 2 ? 1 : hull.length
  for (let k = 0; k < edges; k++) {
    const q = closestOnSegment(p, hull[k], hull[(k + 1) % hull.length])
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < bestDistance) {
      bestDistance = d
      best = q
    }
  }
  return best
}

// 활성 바퀴의 최소 노름 해(입력 순서의 하중, 비활성은 0)
function minimumNorm(points: readonly Vec2[], active: readonly boolean[], d: number[]): number[] {
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]
  points.forEach((p, i) => {
    if (!active[i]) return
    const a = [1, p.y, -p.x]
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r][c] += a[r] * a[c]
  })
  const pinv = pseudoInverse3(m)
  const w = [0, 1, 2].map((r) => pinv[r][0] * d[0] + pinv[r][1] * d[1] + pinv[r][2] * d[2])
  return points.map((p, i) => (active[i] ? w[0] + w[1] * p.y - w[2] * p.x : 0))
}

// 하중이 식을 지키는지(활성 집합 해가 받쳐지는 ZMP에서 껍질 안 해를 찾지 못한 경우를 잡는다)
function residual(points: readonly Vec2[], loads: readonly number[], d: readonly number[]): number {
  let fz = 0
  let mx = 0
  let my = 0
  points.forEach((p, i) => {
    fz += loads[i]
    mx += p.y * loads[i]
    my -= p.x * loads[i]
  })
  return Math.abs(fz - d[0]) + Math.hypot(mx - d[1], my - d[2])
}

// 받쳐지는 ZMP z(껍질 안)에서 껍질 꼭짓점의 부채꼴 삼각형으로 나눈 무게(대체 경로, 결정적)
function hullWeights(
  points: readonly Vec2[],
  hull: readonly Vec2[],
  z: Vec2,
  fz: number
): number[] {
  const index = (q: Vec2): number => points.findIndex((p) => p.x === q.x && p.y === q.y)
  const loads = points.map(() => 0)
  if (hull.length === 1) {
    loads[index(hull[0])] = fz
    return loads
  }
  if (hull.length === 2) {
    const [a, b] = hull
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length2 = dx * dx + dy * dy
    const t =
      length2 > 0 ? Math.min(1, Math.max(0, ((z.x - a.x) * dx + (z.y - a.y) * dy) / length2)) : 0
    loads[index(a)] += fz * (1 - t)
    loads[index(b)] += fz * t
    return loads
  }
  for (let k = 1; k + 1 < hull.length; k++) {
    const a = hull[0]
    const b = hull[k]
    const c = hull[k + 1]
    const area = cross(a, b, c)
    const wa = cross(b, c, z) / area
    const wb = cross(c, a, z) / area
    const wc = cross(a, b, z) / area
    const tol = -1e-9
    if ((wa >= tol && wb >= tol && wc >= tol) || k + 2 === hull.length) {
      const clamp = (x: number): number => Math.max(0, x)
      const sum = clamp(wa) + clamp(wb) + clamp(wc)
      loads[index(a)] += (fz * clamp(wa)) / sum
      loads[index(b)] += (fz * clamp(wb)) / sum
      loads[index(c)] += (fz * clamp(wc)) / sum
      return loads
    }
  }
  return loads
}

// 하중 분배. fz ≤ 0이거나 바퀴가 없으면 모두 0이다(들린 로봇: 평면 모델에서는 생기지 않는다).
export function distributeWheelLoads(
  points: readonly Vec2[],
  fz: number,
  mx: number,
  my: number
): WheelLoads {
  if (!(fz > 0) || points.length === 0 || !Number.isFinite(mx) || !Number.isFinite(my))
    return { loads: points.map(() => 0), unsupported: 0 }
  const hull = convexHull(points)
  const zmp = { x: -my / fz, y: mx / fz }
  const z = closestInHull(hull, zmp)
  const unsupported = fz * Math.hypot(zmp.x - z.x, zmp.y - z.y)
  const d = [fz, fz * z.y, -fz * z.x]
  const active = points.map(() => true)
  let loads = minimumNorm(points, active, d)
  for (let round = 0; round < points.length; round++) {
    let worst = -1
    loads.forEach((n, i) => {
      if (active[i] && n < -1e-12 * fz && (worst < 0 || n < loads[worst])) worst = i
    })
    if (worst < 0) break
    active[worst] = false
    loads = minimumNorm(points, active, d)
  }
  loads = loads.map((n) => Math.max(0, n))
  // 활성 집합이 받쳐지는 해를 찾지 못했으면(남은 바퀴의 껍질이 z를 품지 않음) 껍질 삼각형 무게로 나눈다
  if (residual(points, loads, d) > 1e-9 * fz * (1 + Math.hypot(z.x, z.y)))
    loads = hullWeights(points, hull, z, fz)
  return { loads, unsupported }
}
