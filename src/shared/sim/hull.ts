import type { Vec3 } from './worldSpec'

// 볼록 껍질(spec-5 §3.1, 조사 M§3): 결정적 Quickhull. Box3D hull.c(MIT)의 구조를 따른다(가장 먼 점부터 넣어 꼭짓점 한도까지 채우는
// "안에 그린" 껍질, 거의 같은 평면의 면 합치기). three ConvexHull은 같은 평면의 면을 합치지 않고 공차가 기계 오차 수준이라
// 쓰지 않는다(시험 오라클로만 쓴다, scene/hullOracle.test.ts).
//
// 순수 TS이고 결정적이다: 배열 순서만 쓰고, 같으면 작은 순번을 고르고, Map은 키 찾기에만 쓴다(순서를 결과에 쓰지 않는다).
// 입력 점은 0.1 mm 격자로 맞추고 사전식으로 정렬하므로 결과는 입력 순서와 관계없다(CAD 메시 순서·테셀레이션 잡음이 들어가지 않는다).
// 같은 입력이면 같은 껍질이다(렌더러가 보낸 점 V로 메인이 canonicalHull(V)를 다시 만들고 렌더러도 같은 canonicalHull(V)를 쓴다,
// spec-5 §1.11 정규 입력). 상자·기둥은 위상을 아는 정확한 껍질(boxHull·prismHull)이고 양자화·합치기를 하지 않는다.
//
// 이 모듈은 STEP 워커(cad/stepImport.ts)도 import하므로 three·DOM을 쓰지 않는다. worldSpec에서는 import type만 한다(worldSpec.ts가
// 검사에 canonicalHull 값을 import하므로 값 import는 순환이 된다).

// 양자화 격자(m, 0.1 mm) [조사 결정 M§3 2]
export const HULL_GRID = 1e-4
// 기본 꼭짓점 한도: Box3D "boulder" 32점 껍질(59면·89모서리, M§3)
export const HULL_DEFAULT_VERTEX_LIMIT = 32
// 꼭짓점 하드 한도(SAT 비용) [결정]
export const MAX_HULL_POINTS = 64
// 면 바깥 판정(m) [결정: |좌표| ≤ 10 m의 배정밀도 외적 잡음(~1e-14)보다 크고 격자보다 훨씬 작다]
export const HULL_EPSILON = 1e-9
// cos 3°(리터럴: 모듈이 Math.cos를 부르지 않게) [조사 결정 M§3 5]
export const HULL_MERGE_COS = 0.9986295347545738
// 합친 면의 평면에서 꼭짓점이 벗어나도 되는 거리(m, 격자 한 칸, M§3 5 Newell 0.1 mm)
export const HULL_MERGE_DISTANCE = 1e-4
// 부피 하한(m³, 1 mm³) [결정, M§3 7]
export const HULL_MIN_VOLUME = 1e-9
// 가장 얇은 폭(면 법선 방향 폭의 최소) 하한(m) [P-L17, 결정: 0.1 mm 양자화 잡음이 만든 얇은 판 껍질이 SAT 법선 뒤집힘으로
// 통과되지 않게]
export const HULL_MIN_THICKNESS = 1e-3
// 양자화 키를 double 정수로 정확히 묶는 좌표 한도(m): |x| ≤ 6.5면 |round(x·10⁴)| ≤ 65000 < 2¹⁶ [결정]
export const HULL_MAX_COORD = 6.5

// 꼭짓점: 바깥에서 볼 때 반시계, 평면 n·x = offset(면의 모든 꼭짓점이 평면 위나 안쪽)
export type HullFace = { vertices: number[]; normal: Vec3; offset: number }
// a < b, left는 a → b를 반시계로 가진 면, right는 b → a를 가진 면(면 순번)
export type HullEdge = { a: number; b: number; left: number; right: number }
// error: 넣지 못한 입력 점이 최종 면 평면 밖으로 나간 거리의 최대(평면 거리, 0 이상). 위상이 정해진 껍질은 0
export type Hull = {
  vertices: Vec3[]
  faces: HullFace[]
  edges: HullEdge[]
  centroid: Vec3
  volume: number
  error: number
}
// 점 입력: Vec3 배열이거나 xyz를 이어 붙인 수 배열(Float32Array: 워커의 메시 position)
export type HullInput = readonly Vec3[] | ArrayLike<number>

// ---- 양자화 ----

// 격자 한 칸의 역수(정수라 x·10000은 결정적이다. 1e-4는 double로 정확하지 않으므로 나누지 않는다)
const GRID_SCALE = 10000
// 키 = (k_x + 2¹⁶)·2³⁴ + (k_y + 2¹⁶)·2¹⁷ + (k_z + 2¹⁶): 각 성분이 [0, 2¹⁷) 안이라 키 < 2⁵¹이고 double 정수로 정확하다
const KEY_OFFSET = 65536
const KEY_BASE = 131072
const KEY_BASE2 = 17179869184

function isFlat(points: HullInput): points is ArrayLike<number> {
  return points.length > 0 && typeof (points as ArrayLike<unknown>)[0] === 'number'
}

// 정렬하고 같은 것을 뺀 양자화 키. 좌표가 유한하지 않거나 |x| > HULL_MAX_COORD이거나 수 배열 길이가 3의 배수가 아니면 null
function quantizedKeys(points: HullInput): Float64Array | null {
  const flat = isFlat(points)
  if (flat && points.length % 3 !== 0) return null
  const count = flat ? points.length / 3 : points.length
  const keys = new Float64Array(count)
  const component = (value: number): number => {
    // NaN도 여기서 걸린다
    if (!(Math.abs(value) <= HULL_MAX_COORD)) return NaN
    return Math.round(value * GRID_SCALE) + KEY_OFFSET
  }
  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number
    if (flat) {
      const p = points as ArrayLike<number>
      x = p[3 * i]
      y = p[3 * i + 1]
      z = p[3 * i + 2]
    } else {
      const p = (points as readonly Vec3[])[i]
      x = p.x
      y = p.y
      z = p.z
    }
    const kx = component(x)
    const ky = component(y)
    const kz = component(z)
    if (Number.isNaN(kx) || Number.isNaN(ky) || Number.isNaN(kz)) return null
    keys[i] = kx * KEY_BASE2 + ky * KEY_BASE + kz
  }
  keys.sort()
  let unique = 0
  for (let i = 0; i < count; i++)
    if (i === 0 || keys[i] !== keys[unique - 1]) keys[unique++] = keys[i]
  return keys.subarray(0, unique)
}

// 키 → 좌표(xyz를 이어 붙임). k / 10000은 −0을 만들지 않는다(k + 2¹⁶ − 2¹⁶ = +0)
function decodeKeys(keys: Float64Array): Float64Array {
  const out = new Float64Array(keys.length * 3)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const kz = key % KEY_BASE
    const rest = (key - kz) / KEY_BASE
    const ky = rest % KEY_BASE
    const kx = (rest - ky) / KEY_BASE
    out[3 * i] = (kx - KEY_OFFSET) / GRID_SCALE
    out[3 * i + 1] = (ky - KEY_OFFSET) / GRID_SCALE
    out[3 * i + 2] = (kz - KEY_OFFSET) / GRID_SCALE
  }
  return out
}

// 점을 0.1 mm 격자로 맞추고 사전식(x, y, z)으로 정렬해 같은 것을 뺀다. 결과는 입력 순서와 관계없다.
// 좌표가 유한하지 않거나 |x| > HULL_MAX_COORD인 점, 길이가 3의 배수가 아닌 수 배열은 RangeError다(buildHull은 null을 돌려준다).
export function quantizePoints(points: HullInput): Vec3[] {
  const keys = quantizedKeys(points)
  if (!keys) throw new RangeError('hull: points out of range')
  const p = decodeKeys(keys)
  const out: Vec3[] = []
  for (let i = 0; i < keys.length; i++) out.push({ x: p[3 * i], y: p[3 * i + 1], z: p[3 * i + 2] })
  return out
}

// ---- 작은 선형 대수(사칙연산과 Math.sqrt만) ----

type V3 = [number, number, number]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
// −0을 만들지 않는 부호 바꾸기
const neg = (value: number): number => (value === 0 ? 0 : -value)
const vec = (v: V3): Vec3 => ({ x: v[0] + 0, y: v[1] + 0, z: v[2] + 0 })
const arr = (v: Vec3): V3 => [v.x, v.y, v.z]

// 단위 벡터(길이가 0이면 null)
function unit(v: V3): V3 | null {
  const length = Math.sqrt(dot(v, v))
  if (!(length > 0)) return null
  return [v[0] / length, v[1] / length, v[2] / length]
}

// Newell 법선(단위, 첫 꼭짓점 기준 좌표로 반올림을 줄인다). 다각형이 퇴화면 null
function newellNormal(points: readonly V3[]): V3 | null {
  const o = points[0]
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < points.length; i++) {
    const a = sub(points[i], o)
    const b = sub(points[(i + 1) % points.length], o)
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  return unit([nx, ny, nz])
}

// ---- Quickhull ----

type Tri = {
  v: [number, number, number]
  n: V3
  d: number
  alive: boolean
  // 충돌점(점 순번 오름차순)과 그 가운데 가장 먼 점(같으면 작은 순번)
  conflict: number[]
  best: number
  bestDistance: number
}

// 다각형 하나(합치기 단계): 꼭짓점(반시계)과 Newell 법선
type Poly = { v: number[]; n: V3 }

function point(p: Float64Array, i: number): V3 {
  return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
}

// 볼록 껍질(꼭짓점 한도 vertexLimit, 기본 HULL_DEFAULT_VERTEX_LIMIT, [4, MAX_HULL_POINTS]로 자름). 같은 직선·같은 평면, 부피 <
// HULL_MIN_VOLUME, 폭 < HULL_MIN_THICKNESS, |좌표| > HULL_MAX_COORD, 유한하지 않은 좌표, 점 4개 미만이면 null이다.
export function buildHull(
  points: HullInput,
  vertexLimit: number = HULL_DEFAULT_VERTEX_LIMIT
): Hull | null {
  const keys = quantizedKeys(points)
  if (!keys || keys.length < 4) return null
  const p = decodeKeys(keys)
  const count = keys.length
  const limit = Number.isFinite(vertexLimit)
    ? Math.min(MAX_HULL_POINTS, Math.max(4, Math.floor(vertexLimit)))
    : HULL_DEFAULT_VERTEX_LIMIT

  // 2. 처음 단체: 정렬 첫 점, 그 점에서 가장 먼 점, 그 직선에서 가장 먼 점, 그 평면에서 가장 먼 점(같으면 작은 순번)
  const p0 = point(p, 0)
  let i1 = -1
  let best = 0
  for (let i = 1; i < count; i++) {
    const d = sub(point(p, i), p0)
    const distance = dot(d, d)
    if (distance > best) {
      best = distance
      i1 = i
    }
  }
  if (i1 < 0 || !(Math.sqrt(best) > HULL_EPSILON)) return null
  const axis = unit(sub(point(p, i1), p0))!
  let i2 = -1
  best = 0
  for (let i = 1; i < count; i++) {
    const c = cross(sub(point(p, i), p0), axis)
    const distance = dot(c, c)
    if (distance > best) {
      best = distance
      i2 = i
    }
  }
  if (i2 < 0 || !(Math.sqrt(best) > HULL_EPSILON)) return null
  const plane = unit(cross(sub(point(p, i1), p0), sub(point(p, i2), p0)))
  if (!plane) return null
  let i3 = -1
  best = 0
  let side = 0
  for (let i = 1; i < count; i++) {
    const signed = dot(plane, sub(point(p, i), p0))
    if (Math.abs(signed) > best) {
      best = Math.abs(signed)
      side = signed
      i3 = i
    }
  }
  if (i3 < 0 || !(best > HULL_EPSILON)) return null

  const tris: Tri[] = []
  // 방향이 있는 모서리 a → b의 면(키 찾기에만 쓴다)
  const edgeFace = new Map<number, number>()
  const edgeKey = (a: number, b: number): number => a * count + b
  let degenerate = false
  const addTri = (a: number, b: number, c: number): number => {
    const pa = point(p, a)
    const n = unit(cross(sub(point(p, b), pa), sub(point(p, c), pa)))
    if (!n) degenerate = true
    const normal = n ?? [0, 0, 1]
    const index = tris.length
    tris.push({
      v: [a, b, c],
      n: normal,
      d: dot(normal, pa),
      alive: true,
      conflict: [],
      best: -1,
      bestDistance: 0
    })
    edgeFace.set(edgeKey(a, b), index)
    edgeFace.set(edgeKey(b, c), index)
    edgeFace.set(edgeKey(c, a), index)
    return index
  }
  const distanceTo = (tri: Tri, i: number): number =>
    tri.n[0] * p[3 * i] + tri.n[1] * p[3 * i + 1] + tri.n[2] * p[3 * i + 2] - tri.d
  const assign = (tri: Tri, i: number, distance: number): void => {
    tri.conflict.push(i)
    if (distance > tri.bestDistance) {
      tri.bestDistance = distance
      tri.best = i
    }
  }

  // 밑면 (a, b, c)의 법선이 넷째 점 반대쪽이 되게: 넷째 점이 plane의 +쪽이면 (0, i2, i1), 아니면 (0, i1, i2)
  const [a, b, c] = side > 0 ? [0, i2, i1] : [0, i1, i2]
  const d = i3
  addTri(a, b, c)
  addTri(b, a, d)
  addTri(c, b, d)
  addTri(a, c, d)
  if (degenerate) return null

  // 3. 충돌점: 나머지 점을 정렬 순서로 보며 처음으로 거리 > ε인 면(면 순번 순)에 넣는다
  const simplex = new Set([0, i1, i2, i3])
  for (let i = 0; i < count; i++) {
    if (simplex.has(i)) continue
    for (const tri of tris) {
      const distance = distanceTo(tri, i)
      if (distance > HULL_EPSILON) {
        assign(tri, i, distance)
        break
      }
    }
  }

  // 4. 가장 먼 점 넣기
  // 살아 있는 면(순서는 결과에 쓰지 않는다: 가장 먼 점은 점 순번으로 가른다, 점은 한 면에만 든다)
  let live = [0, 1, 2, 3]
  let vertices = 4
  while (vertices < limit) {
    // 모든 면의 충돌점 가운데 거리가 가장 큰 점(같으면 정렬 순번이 작은 점, Box3D 전역 최대)
    let eyeFace = -1
    for (const f of live) {
      const tri = tris[f]
      if (tri.best < 0) continue
      if (
        eyeFace < 0 ||
        tri.bestDistance > tris[eyeFace].bestDistance ||
        (tri.bestDistance === tris[eyeFace].bestDistance && tri.best < tris[eyeFace].best)
      )
        eyeFace = f
    }
    if (eyeFace < 0) break
    const eye = tris[eyeFace].best
    // 보이는 면을 깊이 우선으로(그 점의 면에서 시작, 이웃은 면의 모서리 순서) 찾아 지평선을 만든다(quickhull3d computeHorizon 꼴)
    const visible = new Set<number>()
    const visibleOrder: number[] = []
    const horizon: [number, number][] = []
    const visit = (f: number, entry: number): void => {
      visible.add(f)
      visibleOrder.push(f)
      const tri = tris[f]
      // 처음 면은 세 모서리, 들어온 면은 들어온 모서리 다음부터 둘
      const steps = entry < 0 ? 3 : 2
      const start = entry < 0 ? 0 : entry + 1
      for (let s = 0; s < steps; s++) {
        const k = (start + s) % 3
        const from = tri.v[k]
        const to = tri.v[(k + 1) % 3]
        const neighbor = edgeFace.get(edgeKey(to, from))
        if (neighbor === undefined) continue
        if (visible.has(neighbor)) continue
        if (distanceTo(tris[neighbor], eye) > HULL_EPSILON) {
          const v = tris[neighbor].v
          const back = v[0] === to ? 0 : v[1] === to ? 1 : 2
          visit(neighbor, back)
        } else horizon.push([from, to])
      }
    }
    visit(eyeFace, -1)
    // 지평선은 닫힌 단순 고리여야 한다(공차 근처의 드문 퇴화면 넣기를 멈춘다: 남은 충돌점은 오차에 든다)
    let simple = horizon.length >= 3
    const seen = new Set<number>()
    for (let h = 0; simple && h < horizon.length; h++) {
      if (horizon[h][1] !== horizon[(h + 1) % horizon.length][0] || seen.has(horizon[h][0]))
        simple = false
      seen.add(horizon[h][0])
    }
    if (!simple) break
    // 버려진 면의 충돌점(점 순번 순)
    const orphans: number[] = []
    for (const f of visibleOrder) {
      const tri = tris[f]
      tri.alive = false
      for (const i of tri.conflict) if (i !== eye) orphans.push(i)
      tri.conflict = []
      tri.best = -1
      for (let k = 0; k < 3; k++) {
        const key = edgeKey(tri.v[k], tri.v[(k + 1) % 3])
        if (edgeFace.get(key) === f) edgeFace.delete(key)
      }
    }
    orphans.sort((x, y) => x - y)
    // 지평선 순서로 새 삼각형
    const created: number[] = []
    for (const [from, to] of horizon) created.push(addTri(from, to, eye))
    if (degenerate) return null
    for (const i of orphans) {
      for (const f of created) {
        const distance = distanceTo(tris[f], i)
        if (distance > HULL_EPSILON) {
          assign(tris[f], i, distance)
          break
        }
      }
    }
    live = live.filter((f) => tris[f].alive)
    for (const f of created) live.push(f)
    // 꼭짓점 수: 보이는 면의 꼭짓점 가운데 지평선에 없는 것은 모든 면이 보였으므로 안쪽이 되어 빠지고, 눈 점이 더해진다
    const onHorizon = new Set(horizon.map(([from]) => from))
    const inside = new Set<number>()
    for (const f of visibleOrder) for (const v of tris[f].v) if (!onHorizon.has(v)) inside.add(v)
    vertices += 1 - inside.size
  }

  // 넣지 못한 충돌점(오차 계산에 쓴다)
  const remaining: number[] = []
  // (전개 인자는 큰 메시의 충돌점 수에서 호출 스택을 넘으므로 하나씩 넣는다)
  for (const tri of tris) if (tri.alive) for (const i of tri.conflict) remaining.push(i)

  // 5. 면 합치기(합치지 않은 삼각형은 아래 대체에 쓴다)
  const triangles: Poly[] = tris
    .filter((tri) => tri.alive)
    .map((tri) => ({ v: [...tri.v], n: tri.n }))
  let polys = mergeFaces(triangles, p)
  // 차수 2인 꼭짓점(면 둘만 만남 = 모서리 위)을 두 면에서 뺀다
  const degree = new Map<number, number>()
  for (const poly of polys) for (const v of poly.v) degree.set(v, (degree.get(v) ?? 0) + 1)
  if ([...degree.values()].some((k) => k === 2))
    polys = polys.map((poly) => ({ v: poly.v.filter((v) => degree.get(v) !== 2), n: poly.n }))
  // 6–9. 정규화·평면·검사·오차
  const finish = (list: Poly[]): Hull | null => {
    if (list.some((poly) => poly.v.length < 3)) return null
    const kept = [...new Set(list.flatMap((poly) => poly.v))].sort((x, y) => x - y)
    const renumber = new Map(kept.map((v, i) => [v, i]))
    return finishHull(
      kept.map((i) => point(p, i)),
      list.map((poly) => poly.v.map((v) => renumber.get(v)!)),
      CLOUD_LIMITS
    )
  }
  // 합치기·차수 2 빼기가 위상을 깨면(얇은 조각 삼각형이 합친 면과 모서리 둘을 나눠 꼭짓점 둘로 줄거나, 빼낸 꼭짓점이 새 면 밖에
  // 남음) 합치지 않은 Quickhull 삼각형으로 마친다. 삼각형 껍질은 늘 볼록 다양체라 퇴화(부피·폭)만 null이 된다. 합치기가 되는
  // 입력은 그대로다 [결정: 5 리뷰, 얇은 판 구름 0.3%가 퇴화가 아닌데 null이었다]
  const hull = finish(polys) ?? finish(triangles)
  if (!hull) return null
  let error = 0
  for (const i of remaining) {
    const q = point(p, i)
    for (const face of hull.faces) {
      const distance = dot(arr(face.normal), q) - face.offset
      if (distance > error) error = distance
    }
  }
  return { ...hull, error }
}

// 면 합치기: 모서리를 (작은 꼭짓점, 큰 꼭짓점) 사전순으로 보며 처음으로 합칠 수 있는 두 면을 합치고, 합치면 처음부터 다시 본다(합칠
// 것이 없을 때까지, 면 수가 줄기만 해서 끝난다). 합치기를 거절한 면 짝은 두 면이 그대로인 동안 다시 재도 같으므로 기억해 두고
// 다시 재지 않는다(합친 면은 새 번호라 기억에 걸리지 않는다). 그래서 결과는 매번 처음부터 모두 다시 재는 것과 같다.
function mergeFaces(initial: Poly[], p: Float64Array): Poly[] {
  const faces: (Poly | null)[] = [...initial]
  // 모서리마다 양쪽 면(키 찾기에만 Map을 쓴다)
  type Edge = { lo: number; hi: number; a: number; b: number }
  const count = p.length / 3
  const byKey = new Map<number, Edge>()
  const edges: Edge[] = []
  initial.forEach((poly, f) => {
    for (let k = 0; k < poly.v.length; k++) {
      const x = poly.v[k]
      const y = poly.v[(k + 1) % poly.v.length]
      const lo = Math.min(x, y)
      const hi = Math.max(x, y)
      const edge = byKey.get(lo * count + hi)
      if (edge) edge.b = f
      else {
        const created = { lo, hi, a: f, b: -1 }
        byKey.set(lo * count + hi, created)
        edges.push(created)
      }
    }
  })
  edges.sort((x, y) => x.lo - y.lo || x.hi - y.hi)
  // 거절한 면 짝(면 번호는 합친 면까지 2·초기 면 수보다 작다)
  const pairKey = (x: number, y: number): number =>
    Math.min(x, y) * 2 * (initial.length + 1) + Math.max(x, y)
  const rejected = new Set<number>()
  let e = 0
  while (e < edges.length) {
    const edge = edges[e]
    const left = edge.a >= 0 ? faces[edge.a] : null
    const right = edge.b >= 0 ? faces[edge.b] : null
    const pair = pairKey(edge.a, edge.b)
    if (!left || !right || edge.a === edge.b || rejected.has(pair)) {
      e++
      continue
    }
    const merged =
      dot(left.n, right.n) < HULL_MERGE_COS ? null : mergePolygons(left, right, edge.lo, edge.hi, p)
    if (!merged) {
      rejected.add(pair)
      e++
      continue
    }
    const m = faces.length
    faces.push(merged)
    const [fa, fb] = [edge.a, edge.b]
    faces[fa] = null
    faces[fb] = null
    edges.splice(e, 1)
    // 처음부터 다시 보는 것과 같다: 앞 모서리 가운데 합친 면이 든 것만 다시 재면 된다(나머지는 두 면이 그대로라 거절 그대로)
    let restart = e
    edges.forEach((other, i) => {
      let touched = false
      if (other.a === fa || other.a === fb) {
        other.a = m
        touched = true
      }
      if (other.b === fa || other.b === fb) {
        other.b = m
        touched = true
      }
      if (touched && i < restart) restart = i
    })
    e = restart
  }
  return faces.filter((face): face is Poly => face !== null)
}

// 모서리 (u, v)를 함께 가진 두 다각형을 합친다: 꼭짓점이 겹치지 않고, Newell 평면에서 모든 꼭짓점이 HULL_MERGE_DISTANCE 안이고,
// 볼록할 때만(연속 세 꼭짓점의 가운데 점이 양끝을 이은 직선에서 바깥으로 −HULL_EPSILON보다 덜 들어감: 같은 직선 위 점은
// 받고 뒤의 차수 2 꼭짓점 빼기가 지운다)
function mergePolygons(
  left: Poly,
  right: Poly,
  u: number,
  v: number,
  p: Float64Array
): Poly | null {
  // left에서 u → v 방향인 쪽을 L로
  const forward = (poly: Poly, a: number, b: number): boolean => {
    const k = poly.v.indexOf(a)
    return poly.v[(k + 1) % poly.v.length] === b
  }
  const [l, r] = forward(left, u, v) ? [left, right] : [right, left]
  if (!forward(l, u, v) || !forward(r, v, u)) return null
  // L을 v에서 시작해 u로 끝나게, R을 u에서 시작해 v로 끝나게 돌린다
  const rotate = (list: number[], start: number): number[] => {
    const k = list.indexOf(start)
    return [...list.slice(k), ...list.slice(0, k)]
  }
  const lv = rotate(l.v, v)
  const ru = rotate(r.v, u)
  const merged = [...lv, ...ru.slice(1, -1)]
  if (new Set(merged).size !== merged.length) return null
  const pts = merged.map((i) => point(p, i))
  const n = newellNormal(pts)
  if (!n) return null
  let cx = 0
  let cy = 0
  let cz = 0
  for (const q of pts) {
    cx += q[0]
    cy += q[1]
    cz += q[2]
  }
  const center: V3 = [cx / pts.length, cy / pts.length, cz / pts.length]
  const offset = dot(n, center)
  if (pts.some((q) => Math.abs(dot(n, q) - offset) > HULL_MERGE_DISTANCE)) return null
  for (let k = 0; k < pts.length; k++) {
    const prev = pts[(k + pts.length - 1) % pts.length]
    const here = pts[k]
    const next = pts[(k + 1) % pts.length]
    const chord = sub(next, prev)
    const length = Math.sqrt(dot(chord, chord))
    if (!(length > 0)) return null
    const turn = dot(cross(sub(here, prev), sub(next, here)), n) / length
    if (!(turn > -HULL_EPSILON)) return null
  }
  return { v: merged, n }
}

// 검사(8)의 허용과 하한. plane: 모든 꼭짓점이 모든 면 평면 안쪽이어야 하는 허용, volume·thickness: 부피·가장 얇은 폭의 하한
// (이상이면 받는다).
type HullLimits = { plane: number; volume: number; thickness: number }
// 점 구름 껍질(buildHull): 합친 면의 허용과 퇴화 하한(spec-5 §3.1 8)
const CLOUD_LIMITS: HullLimits = {
  plane: HULL_MERGE_DISTANCE,
  volume: HULL_MIN_VOLUME,
  thickness: HULL_MIN_THICKNESS
}
// 위상을 아는 정확한 껍질(boxHull·prismHull): 평면은 반올림만 허용하고(좌표 10 m에서 1e-14 크기) 부피·폭은 0보다 크기만 본다
// (Number.MIN_VALUE 이상 = 양수) [결정: 상자 반 크기 하한 MIN_BOX_SIZE/2(worldSpec.ts)에서는 폭이 정확히 HULL_MIN_THICKNESS라
// 반올림으로 하한 아래가 될 수 있다. 퇴화 하한은 점 구름의 양자화 잡음을 거르는 것이라 정해진 위상에는 쓰지 않는다]
const EXACT_LIMITS: HullLimits = {
  plane: HULL_EPSILON,
  volume: Number.MIN_VALUE,
  thickness: Number.MIN_VALUE
}

// 정규화(6)·평면(7)·검사(8): faces는 꼭짓점 번호(vertices 순번)의 반시계 목록. 면 목록은 가장 작은 번호부터 돌리고 사전순으로
// 정렬하고, 모서리는 (a, b) 사전순이다. 법선은 Newell(단위), offset은 면 꼭짓점의 n·v 최대. 검사(Euler, 다양체, 볼록, 부피,
// 폭, limits)에 실패하면 null
function finishHull(points: readonly V3[], faces: number[][], limits: HullLimits): Hull | null {
  const rotated = faces.map((list) => {
    let k = 0
    for (let i = 1; i < list.length; i++) if (list[i] < list[k]) k = i
    return [...list.slice(k), ...list.slice(0, k)]
  })
  rotated.sort((x, y) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
    return x.length - y.length
  })
  const outFaces: HullFace[] = []
  for (const list of rotated) {
    if (list.length < 3) return null
    const n = newellNormal(list.map((i) => points[i]))
    if (!n) return null
    let offset = -Infinity
    for (const i of list) offset = Math.max(offset, dot(n, points[i]))
    outFaces.push({ vertices: list, normal: vec(n), offset: offset + 0 })
  }
  // 모서리와 다양체 검사: 방향이 있는 모서리마다 면 하나, 반대 방향도 있어야 한다
  const vertexCount = points.length
  const directed = new Map<number, number>()
  rotated.forEach((list, f) => {
    for (let k = 0; k < list.length; k++) {
      const key = list[k] * vertexCount + list[(k + 1) % list.length]
      if (directed.has(key)) directed.set(key, -1)
      else directed.set(key, f)
    }
  })
  const edges: HullEdge[] = []
  for (const [f, list] of rotated.entries()) {
    for (let k = 0; k < list.length; k++) {
      const a = list[k]
      const b = list[(k + 1) % list.length]
      if (directed.get(a * vertexCount + b) !== f) return null
      const other = directed.get(b * vertexCount + a)
      if (other === undefined || other < 0) return null
      if (a < b) edges.push({ a, b, left: f, right: other })
    }
  }
  edges.sort((x, y) => x.a - y.a || x.b - y.b)
  // Euler V − E + F = 2(모든 꼭짓점이 면에 든다)
  const used = new Set(rotated.flat())
  if (used.size !== points.length) return null
  if (points.length - edges.length + outFaces.length !== 2) return null
  // 모든 꼭짓점이 모든 면 평면 안쪽이고, 가장 얇은 폭 min_f (offset_f − min_v n_f·v)가 하한 이상(한 번에 잰다)
  for (const face of outFaces) {
    const { x: nx, y: ny, z: nz } = face.normal
    let low = Infinity
    for (const q of points) {
      const d = nx * q[0] + ny * q[1] + nz * q[2]
      if (d - face.offset > limits.plane) return null
      if (d < low) low = d
    }
    if (!(face.offset - low >= limits.thickness)) return null
  }
  // 부피·무게중심: 꼭짓점 평균에서 면 부채꼴로 나눈 사면체(발산 정리)
  const ref: V3 = [0, 0, 0]
  for (const q of points) for (let k = 0; k < 3; k++) ref[k] += q[k]
  for (let k = 0; k < 3; k++) ref[k] /= points.length
  let volume = 0
  const moment: V3 = [0, 0, 0]
  for (const list of rotated) {
    const a = sub(points[list[0]], ref)
    for (let i = 1; i + 1 < list.length; i++) {
      const b = sub(points[list[i]], ref)
      const c = sub(points[list[i + 1]], ref)
      const six = dot(a, cross(b, c))
      volume += six
      for (let k = 0; k < 3; k++) moment[k] += six * (a[k] + b[k] + c[k])
    }
  }
  volume /= 6
  if (!(volume >= limits.volume)) return null
  // 사면체 무게중심 = (ref + a + b + c)/4 → Σ(six/6)·(a + b + c)/4 / V + ref
  const centroid: V3 = [0, 1, 2].map((k) => ref[k] + moment[k] / (24 * volume)) as V3
  return {
    vertices: points.map(vec),
    faces: outFaces,
    edges,
    centroid: vec(centroid),
    volume,
    error: 0
  }
}

// 정규 껍질 기억(spec-5 §12 생성자 예산): 메인은 parseWorldSpec 검사에서 만든 껍질을 BodyCollision이 같은 점 배열로 다시 만들고
// (검사가 돌려주는 충돌체가 검사한 배열을 그대로 담는다), 렌더러는 같은 V로 표시·앞 계산·시작 겹침을 여러 번 부른다. 64점 껍질
// 하나가 0.5–0.7 ms라 충돌체 64개 세계에서 두 번 만들면 생성자 목표(30 ms)를 넘었다. 그래서 점 배열 객체를 키로 마지막 결과를
// 기억한다(WeakMap: 키 찾기에만 쓰고 순서를 쓰지 않는다, 배열이 사라지면 함께 사라진다). 그 배열의 지금 좌표가 기억한 좌표와
// Object.is로 모두 같을 때만 쓰므로(배열을 고쳐 쓰면 다시 만든다) 결과 값은 기억 없이 만든 것과 같다(같은 입력 → 같은 함수).
// 같은 객체를 나눠 쓰므로 결과를 깊게 얼린다(고치면 다른 호출이 본다. staticShapes와 같은 규칙).
type CanonicalEntry = { coords: Float64Array; hull: Hull | null }
const canonicalCache = new WeakMap<readonly Vec3[], CanonicalEntry>()

function sameCoords(points: readonly Vec3[], coords: Float64Array): boolean {
  if (coords.length !== 3 * points.length) return false
  for (let i = 0; i < points.length; i++) {
    const q = points[i]
    if (
      !Object.is(q.x, coords[3 * i]) ||
      !Object.is(q.y, coords[3 * i + 1]) ||
      !Object.is(q.z, coords[3 * i + 2])
    )
      return false
  }
  return true
}

function freezeHull(hull: Hull): Hull {
  for (const v of hull.vertices) Object.freeze(v)
  Object.freeze(hull.vertices)
  for (const face of hull.faces) {
    Object.freeze(face.vertices)
    Object.freeze(face.normal)
    Object.freeze(face)
  }
  Object.freeze(hull.faces)
  for (const edge of hull.edges) Object.freeze(edge)
  Object.freeze(hull.edges)
  Object.freeze(hull.centroid)
  return Object.freeze(hull)
}

// 정규 껍질(spec-5 §1.11): buildHull(points, MAX_HULL_POINTS). 렌더러 표시·앞 계산·메인 생성이 모두 이것을 쓴다. 결과는 얼어 있다
// (위 기억)
export function canonicalHull(points: readonly Vec3[]): Hull | null {
  const cached = canonicalCache.get(points)
  if (cached && sameCoords(points, cached.coords)) return cached.hull
  const coords = new Float64Array(3 * points.length)
  points.forEach((q, i) => {
    coords[3 * i] = q.x
    coords[3 * i + 1] = q.y
    coords[3 * i + 2] = q.z
  })
  const built = buildHull(points, MAX_HULL_POINTS)
  const hull = built ? freezeHull(built) : null
  canonicalCache.set(points, { coords, hull })
  return hull
}

// ---- 위상을 아는 정확한 껍질(양자화·합치기 없음) ----

// 위상이 정해진 껍질의 평면·모서리·부피(검사는 EXACT_LIMITS: 평면은 반올림만 허용하고 부피·폭은 양수만 본다). 위상이 틀리면
// 던진다(호출하는 쪽의 버그다)
function exactHull(points: readonly V3[], faces: number[][]): Hull {
  const hull = finishHull(points, faces, EXACT_LIMITS)
  if (!hull) throw new RangeError('hull: invalid exact hull')
  return hull
}

// 상자: 꼭짓점 k의 비트 0·1·2가 자기 x·y·z의 +쪽(seasons/fieldGeometry.ts boxVertices와 같은 순서), center + R·(±half).
// rotation은 행 우선 9개(정규 직교, det > 0). 면은 정해진 여섯 사각형이고 법선은 Newell(축 정렬이면 정확한 ±축)이다.
export function boxHull(center: Vec3, rotation: readonly number[], half: Vec3): Hull {
  const points: V3[] = []
  for (let k = 0; k < 8; k++) {
    const lx = k & 1 ? half.x : neg(half.x)
    const ly = k & 2 ? half.y : neg(half.y)
    const lz = k & 4 ? half.z : neg(half.z)
    points.push([
      center.x + (rotation[0] * lx + rotation[1] * ly + rotation[2] * lz),
      center.y + (rotation[3] * lx + rotation[4] * ly + rotation[5] * lz),
      center.z + (rotation[6] * lx + rotation[7] * ly + rotation[8] * lz)
    ])
  }
  return exactHull(points, BOX_FACES)
}

// 상자 면(바깥에서 반시계): −x, +x, −y, +y, −z, +z
const BOX_FACES: number[][] = [
  [0, 4, 6, 2],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 2, 3, 1],
  [4, 5, 7, 6]
]

// 기둥: 아래 n각형 n점(위에서 볼 때 반시계) + 같은 순서의 위 n점. 위아래 두 면과 사각 옆면 n개. 꼭짓점 순서는 입력 그대로다.
// 아래 다각형이 위 면 쪽에서 볼 때 시계 방향이면 면 방향을 뒤집는다.
export function prismHull(points: readonly Vec3[]): Hull {
  const n = points.length / 2
  if (!Number.isInteger(n) || n < 3) throw new RangeError('hull: prism needs 2n points (n ≥ 3)')
  const pts = points.map(arr)
  const bottom = Array.from({ length: n }, (_, k) => k)
  const top = Array.from({ length: n }, (_, k) => n + k)
  // 아래 다각형 법선과 아래 → 위 방향
  const normal = newellNormal(bottom.map((k) => pts[k]))
  if (!normal) throw new RangeError('hull: degenerate prism')
  let up = 0
  for (let k = 0; k < n; k++) up += dot(normal, sub(pts[n + k], pts[k]))
  const ccw = up > 0
  const faces: number[][] = [ccw ? [...bottom].reverse() : bottom, ccw ? top : [...top].reverse()]
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n
    faces.push(ccw ? [k, k1, n + k1, n + k] : [k1, k, n + k, n + k1])
  }
  return exactHull(pts, faces)
}

// 강체 변환(새 객체, 입력은 바꾸지 않음): 꼭짓점 R·v + t, 법선 R·n, offset d + (R·n)·t. 면의 꼭짓점 목록과 모서리 배열은 같은
// 배열을 함께 쓴다(얼린 껍질도 받는다)
export function transformHull(hull: Hull, rotation: readonly number[], translation: Vec3): Hull {
  const r = rotation
  const apply = (v: Vec3): V3 => [
    r[0] * v.x + r[1] * v.y + r[2] * v.z,
    r[3] * v.x + r[4] * v.y + r[5] * v.z,
    r[6] * v.x + r[7] * v.y + r[8] * v.z
  ]
  const t = arr(translation)
  const move = (v: Vec3): Vec3 => {
    const q = apply(v)
    return vec([q[0] + t[0], q[1] + t[1], q[2] + t[2]])
  }
  return {
    vertices: hull.vertices.map(move),
    faces: hull.faces.map((face) => {
      const n = apply(face.normal)
      return { vertices: face.vertices, normal: vec(n), offset: face.offset + dot(n, t) + 0 }
    }),
    edges: hull.edges,
    centroid: move(hull.centroid),
    volume: hull.volume,
    error: hull.error
  }
}

// 시험·진단용 전수 오차: 양자화한 입력 점 각각의 max_f(n_f·p − d_f)의 최대(0 아래면 0). 범위 밖 입력은 RangeError(quantizePoints)
export function hullError(points: HullInput, hull: Hull): number {
  let error = 0
  for (const q of quantizePoints(points)) {
    const v = arr(q)
    for (const face of hull.faces) {
      const distance = dot(arr(face.normal), v) - face.offset
      if (distance > error) error = distance
    }
  }
  return error
}
