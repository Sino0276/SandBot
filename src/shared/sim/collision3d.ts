import { Articulation } from './articulation'
import { boxHull, canonicalHull, prismHull, transformHull, type Hull } from './hull'
import { rotationMatrix, type FieldOverlap } from './seasons/fieldGeometry'
import { deepFreeze, type FieldSpec } from './seasons/fieldSpec'
import { composeFrames, planarFrame, type Frame3 } from './sensorFrame'
import { SUPPLEMENT_TOLERANCE } from './fieldContact'
import { WALL_FRICTION } from './wheelData'
import { FLOOR_FRICTION, type SimCollider, type Vec3, type WorldSpec } from './worldSpec'

// 3D 충돌 형상과 좁은 단계(spec-5 §3): 필드 정적 형상, 몸체 형상, 세운 원기둥 근사, 볼록 껍질 SAT + 자르기, 둥근 형상(캡슐·구)의
// GJK, 편집 자세 겹침 앞 계산, 시작 겹침. 순수 TS이고 결정적이다(배열 순서만 쓰고, 비교는 엄격한 >, 같으면 작은 순번. Map은
// 키 찾기에만 쓰고 그 순서를 결과에 쓰지 않는다).
//
// 좁은 단계는 GJK/EPA가 아니라 SAT다(M§1.1): 행이 간격 0으로 쉬므로(목표 −max(gap, 0)/h, 피부 없음) 분리 축과 그 위의 자른
// 점이 바로 필요하다. 면 축과 Gauss 지도로 거른 모서리–모서리 축(Gregorius GDC 2013, Box3D convex_manifold.c)을 쓰고, 기준 면에
// 사건 면을 잘라 점을 낸 뒤 4점까지 줄인다. 짝마다 지난 분리 특징을 기억해(SatCache) 하위 단계 사이에 기준이 뒤집히지 않게 하고
// (히스테리시스 FEATURE_TOLERANCE), 닿은 동안 기억이 맞으면 모서리 질의를 건너뛴다(Box3D :1330·1369·1445). 둥근 형상(캡슐·구)이
// 든 짝은 Box3D처럼 GJK 거리가 먼저다(얕음 1–2점, 깊음만 SAT, convex_manifold.c:647–775, P-H2).
//
// 법선 규약: 매니폴드 법선은 B → A(A를 B에서 밀어내는 쪽)다. A는 순서가 앞인 몸체이고 정적은 늘 B다. 행 J = J_A − J_B를 이 방향으로
// 재면 + 가 떨어짐이다. 점 위치는 두 표면의 가운데(기준이 A·B 사이에서 바뀌어도 자리가 안정, Box3D)다.

// 편집 자세 겹침 판정 공차(m): 분리 < −이 값이면 겹침 [사용자 결정 11/10]
export const EDIT_OVERLAP_TOLERANCE = 1e-3
// 세운 원기둥의 외접 다각형 변 수(Box3D b3CreateCylinder)
export const CYLINDER_SIDES = 16
// 이 아래 거리는 "깊음"(법선을 거리 방향으로 낼 수 없음) [결정: Box3D 100·FLT_EPSILON의 배정밀도 판]
export const GJK_MIN_DISTANCE = 1e-9
// GJK 반복 한도와 수렴 판정(거리 줄어듦 < 이 값, m) [결정]
export const GJK_MAX_ITERATIONS = 32
export const GJK_TOLERANCE = 1e-12
// 이 아래 선분(m)은 구 [P-M7, 결정]
export const MIN_CAPSULE_SEGMENT = 1e-6
// Box3D kTolerance(convex_manifold.c:685): |n_ref·δ| > 이 값이면 캡슐 선분을 기준 면 옆 평면으로 잘라 2점
export const CAPSULE_FACE_PARALLEL = 0.998

// 아래 다섯은 bodyCollision.ts가 같은 이름으로 다시 내보낸다(spec-5 §4.2 부록 A의 자리). 좁은 단계(이 파일)가 쓰므로 여기서
// 정한다(bodyCollision.ts는 이 파일을 import하므로 거꾸로 import하면 순환이 된다).
// 특징(기준 면·모서리) 히스테리시스(m) = fieldContact.ts REFERENCE_TOLERANCE(Box2D k_tol = 0.1·linearSlop)
export const FEATURE_TOLERANCE = 5e-4
// 거의 나란한 모서리 짝 건너뛰기(Box3D B3_PARALLEL_EDGE_TOL, convex_manifold.c:140)
export const PARALLEL_EDGE_TOLERANCE = 0.005
// 짝마다 점(Box3D B3_MAX_MANIFOLD_POINTS)
export const MAX_MANIFOLD_POINTS = 4
// 벽 상자를 바닥 아래로 늘이는 깊이(m) [결정: 벽 밑면이 분리 축으로 뽑히지 않게. 바닥 아래에는 아무것도 없다]
export const WALL_BASE_DEPTH = 0.05

// 점 줄이기(§3.5 8)의 공차(m): 두 점이 이보다 가깝거나 삼각형 넓이(×2)가 이것의 제곱보다 작으면 더하지 않는다. Box3D는
// B3_SPECULATIVE_DISTANCE(4·linearSlop = 2 cm)를 쓴다. [결정: FTC 부품 크기에 맞춰 예측 띠 여유 COLLISION_MARGIN 1 mm]
const REDUCE_TOLERANCE = 1e-3
// Box3D b3ReduceManifoldPoints의 순위 치우침(앞 후보를 이 비율만큼 아낀다, 결정적이라 그대로 둔다)
const REDUCE_BIAS = 0.95
// 거의 나란한 캡슐 짝(사인 < 이 값)은 한 선분을 다른 선분 끝 평면으로 잘라 2점(Box3D b3CollideCapsules alphaTol 0.05의 자리,
// spec-5 §3.6 표 "사인 < 0.005")
const PARALLEL_CAPSULE_SINE = 0.005

type V3 = [number, number, number]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const neg = (a: V3): V3 => [-a[0] + 0, -a[1] + 0, -a[2] + 0]
const arr = (v: Vec3): V3 => [v.x, v.y, v.z]
// −0 없이
const vec = (v: V3): Vec3 => ({ x: v[0] + 0, y: v[1] + 0, z: v[2] + 0 })
const length = (a: V3): number => Math.sqrt(dot(a, a))
function normalize(a: V3): V3 | null {
  const l = length(a)
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : null
}
function apply(r: readonly number[], v: V3): V3 {
  return [
    r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
    r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
    r[6] * v[0] + r[7] * v[1] + r[8] * v[2]
  ]
}

// ---- 정적 형상(§3.2) ----

export type StaticShape = {
  // 키: 'w0'…'w3'(+x, −x, +y, −y), 's<구조물 순번>', 'fl'
  token: string
  kind: 'hull' | 'floor'
  // floor는 null
  hull: Hull | null
  friction: number
  // 섀시가 닿는가
  chassis: boolean
  // 관절 몸체가 닿는가
  joints: boolean
  // 알림·경고 대상(seasons/fieldGeometry.ts FieldOverlap)
  target: FieldOverlap | { kind: 'floor' }
}

const STATIC_SHAPES = new WeakMap<FieldSpec, readonly StaticShape[]>()

// 축 정렬 상자 [x0, x1] × [y0, y1] × [z0, z1]의 정확한 껍질: 꼭짓점을 직접 주어(prismHull, 아래 4점 반시계 + 위 4점) 면 평면이
// 받은 좌표와 비트로 같다. boxHull(중심 ± 반 크기)은 (ih + t/2) − t/2가 ih와 1 ulp 다를 수 있어 벽 안쪽 면이 innerHalf와 어긋난다
// [결정: spec-5 §3.2 "벽 안쪽 면 = innerHalf 그대로"를 지키려고 boxHull 대신 같은 상자의 꼭짓점 기둥을 쓴다. 위상은 상자와 같다]
function axisBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Hull {
  const ring = (z: number): Vec3[] => [
    { x: x0, y: y0, z },
    { x: x1, y: y0, z },
    { x: x1, y: y1, z },
    { x: x0, y: y1, z }
  ]
  return prismHull([...ring(z0), ...ring(z1)])
}

// 순서: 벽 넷(+x, −x, +y, −y, contact.ts WALLS 순서) → 구조물(배열 순번 순, 규칙에 맞는 것) → 바닥. 얼린 FieldSpec마다 하나를
// WeakMap에 두고 결과는 깊게 얼린다(BodyCollision은 transformHull로 새 객체만 만든다, P-M11). 양자화하지 않는다: 벽 안쪽 면은
// innerHalf, 구조물 면은 4ab FieldSpec 값 그대로다(P-M4·C-M9).
export function staticShapes(field: FieldSpec): readonly StaticShape[] {
  const cached = STATIC_SHAPES.get(field)
  if (cached) return cached
  const { innerHalf, thickness, height } = field.perimeter
  const outer = innerHalf + thickness
  const z0 = -WALL_BASE_DEPTH
  const wall = (token: string, name: 'x+' | 'x-' | 'y+' | 'y-', hull: Hull): StaticShape => ({
    token,
    kind: 'hull',
    hull,
    friction: WALL_FRICTION,
    chassis: true,
    joints: true,
    target: { kind: 'wall', wall: name }
  })
  // 판 inset·이음은 무시한다(4ab 접촉 기준면과 같은 평면, 레일 윗면이 벽 윗면). 모서리에서 두 벽 상자가 겹친다(정적끼리라 무관)
  const shapes: StaticShape[] = [
    wall('w0', 'x+', axisBox(innerHalf, outer, -outer, outer, z0, height)),
    wall('w1', 'x-', axisBox(-outer, -innerHalf, -outer, outer, z0, height)),
    wall('w2', 'y+', axisBox(-outer, outer, innerHalf, outer, z0, height)),
    wall('w3', 'y-', axisBox(-outer, outer, -outer, -innerHalf, z0, height))
  ]
  field.structures.forEach((s, index) => {
    // HIVE carrier는 늘 뺀다(움직이는 경기 요소). 섀시는 solid만(4ab solidFootprints와 같은 집합), 관절 몸체는 solid ∨ occludes
    // ("실체가 있는 물체", 4d 가림) [결정: FieldSpec에 새 플래그를 두지 않는다]
    if (s.carrier !== 'field') return
    const chassis = s.solid
    const joints = s.solid || s.occludes
    if (!chassis && !joints) return
    const shape = s.shape
    const hull =
      shape.kind === 'box'
        ? boxHull(shape.center, rotationMatrix(shape.rotation), {
            x: shape.size.x / 2,
            y: shape.size.y / 2,
            z: shape.size.z / 2
          })
        : prismHull(cylinderPrism(shape.center, shape.rotation, shape.radius, shape.height))
    shapes.push({
      token: `s${index}`,
      kind: 'hull',
      hull,
      friction: s.friction,
      chassis,
      joints,
      target: { kind: 'structure', index }
    })
  })
  shapes.push({
    token: 'fl',
    kind: 'floor',
    hull: null,
    friction: FLOOR_FRICTION,
    chassis: false,
    joints: true,
    target: { kind: 'floor' }
  })
  const frozen = deepFreeze(shapes)
  STATIC_SHAPES.set(field, frozen)
  return frozen
}

// ---- 몸체 형상(§3.3) ----

export type BodyShape =
  // radius: 몸체 원점에서 가장 먼 꼭짓점 거리(넓은 단계)
  | { kind: 'hull'; hull: Hull; friction: number; radius: number }
  | {
      kind: 'capsule'
      a: Vec3
      b: Vec3
      r: number
      sphere: boolean
      friction: number
      radius: number
    }

// convex → canonicalHull(points), box → boxHull(center, rotation, half), capsule → sphere = |b − a| < MIN_CAPSULE_SEGMENT.
// 볼록 점이 퇴화면 null(parseWorldSpec가 이미 막는다)
export function bodyShape(collider: SimCollider): BodyShape | null {
  if (collider.kind === 'capsule') {
    const a = arr(collider.a)
    const b = arr(collider.b)
    return {
      kind: 'capsule',
      a: vec(a),
      b: vec(b),
      r: collider.radius,
      sphere: length(sub(b, a)) < MIN_CAPSULE_SEGMENT,
      friction: collider.friction,
      radius: Math.max(length(a), length(b)) + collider.radius
    }
  }
  const hull =
    collider.kind === 'box'
      ? boxHull(collider.center, collider.rotation, collider.half)
      : canonicalHull(collider.points)
  if (!hull) return null
  let radius = 0
  for (const v of hull.vertices) radius = Math.max(radius, length(arr(v)))
  return { kind: 'hull', hull, friction: collider.friction, radius }
}

// 같은 틀에 놓인 형상(편집 자세·시작 겹침·SAT 입력). 캡슐은 선분 + 반지름
export type PlacedShape =
  { kind: 'hull'; hull: Hull } | { kind: 'capsule'; a: Vec3; b: Vec3; r: number; sphere: boolean }

// 몸체 틀 → 그 틀의 부모(로봇 좌표·C): 껍질은 transformHull(R, o), 캡슐 끝점은 R·v + o
export function placeShape(shape: BodyShape, frame: Frame3): PlacedShape {
  if (shape.kind === 'hull')
    return { kind: 'hull', hull: transformHull(shape.hull, frame.rotation, frame.origin) }
  const o = arr(frame.origin)
  return {
    kind: 'capsule',
    a: vec(add(apply(frame.rotation, arr(shape.a)), o)),
    b: vec(add(apply(frame.rotation, arr(shape.b)), o)),
    r: shape.r,
    sphere: shape.sphere
  }
}

// ---- 세운 원기둥 = 외접 16각 기둥(§3.4) ----

// 한 사분면의 cos θ_k(θ_k = k·22.5°, k = 0…3)와 sin θ_k. 제곱근 식만 쓴다(원기둥 근사에 새 Math.sin·cos가 없다)
const COS_22_5 = Math.sqrt(2 + Math.SQRT2) / 2
const COS_45 = Math.SQRT2 / 2
const COS_67_5 = Math.sqrt(2 - Math.SQRT2) / 2
const QUADRANT_COS = [1, COS_22_5, COS_45, COS_67_5]
const QUADRANT_SIN = [0, COS_67_5, COS_45, COS_22_5]
// cos 11.25° = √(2 + √(2 + √2))/2: 외접 다각형 반지름 R = r / cos(11.25°)(변이 원에 닿는다, R = 1.0196·r)
const COS_11_25 = Math.sqrt(2 + Math.sqrt(2 + Math.SQRT2)) / 2

// 32점(아래 16 반시계 + 위 16). 꼭짓점 각 k·22.5°, 반지름 r / cos(11.25°). 회전은 지금 구조물처럼 rotationMatrix(rotation)
// (sin·cos, 4ab와 같음)이고 자기 z가 축이다
export function cylinderPrism(
  center: Vec3,
  rotation: Vec3,
  radius: number,
  height: number
): Vec3[] {
  const m = rotationMatrix(rotation)
  const big = radius / COS_11_25
  const c = arr(center)
  const ring = (z: number): Vec3[] =>
    Array.from({ length: CYLINDER_SIDES }, (_, k) => {
      const q = Math.floor(k / 4)
      const i = k % 4
      // 사분면 q만큼 반시계 90°씩 돌린다: (x, y) → (−y, x)
      let x = QUADRANT_COS[i]
      let y = QUADRANT_SIN[i]
      for (let turn = 0; turn < q; turn++) {
        const t = x
        x = -y
        y = t
      }
      return vec(add(c, apply(m, [big * x, big * y, z])))
    })
  return [...ring(-height / 2), ...ring(height / 2)]
}

// ---- 껍질 위상(하위 단계마다 만드는 transformHull 사본은 faces·edges 배열을 함께 쓰므로 edges 배열로 기억한다) ----

type Topology = {
  // 면 f의 꼭짓점 k → k + 1 모서리 순번
  faceEdges: number[][]
  // 꼭짓점마다 그 꼭짓점을 가진 면(오름차순)
  vertexFaces: number[][]
}

const TOPOLOGY = new WeakMap<object, Topology>()

function topology(hull: Hull): Topology {
  const cached = TOPOLOGY.get(hull.edges)
  if (cached) return cached
  const count = hull.vertices.length
  // 키 찾기에만 쓴다
  const byPair = new Map<number, number>()
  hull.edges.forEach((e, i) => byPair.set(e.a * count + e.b, i))
  const faceEdges = hull.faces.map((face) =>
    face.vertices.map((v, k) => {
      const w = face.vertices[(k + 1) % face.vertices.length]
      return byPair.get(Math.min(v, w) * count + Math.max(v, w)) as number
    })
  )
  const vertexFaces: number[][] = hull.vertices.map(() => [])
  hull.faces.forEach((face, f) => {
    for (const v of face.vertices) vertexFaces[v].push(f)
  })
  const result = { faceEdges, vertexFaces }
  TOPOLOGY.set(hull.edges, result)
  return result
}

// ---- SAT 껍질–껍질(§3.5) ----

export type SatCache = {
  kind: 'faceA' | 'faceB' | 'edge'
  a: number
  b: number
  separation: number
  touching: boolean
} | null
export type ManifoldPoint = { position: Vec3; normal: Vec3; separation: number; id: string }
// normal: B → A, points.length ≤ 4
export type Manifold = { reference: string; normal: Vec3; points: ManifoldPoint[] }

// A의 0번 꼭짓점을 원점으로 옮긴 틀의 껍질(Box2D v3처럼 반올림을 줄인다, §3.5 2): 꼭짓점·면 offset을 옮기고 모서리마다 방향과
// 양쪽 면 법선을 둔다
type Prepared = {
  hull: Hull
  topo: Topology
  // 꼭짓점(3·V), 면 법선(3·F), 면 offset(F)
  p: Float64Array
  n: Float64Array
  d: Float64Array
  centroid: V3
  vertexCount: number
  faceCount: number
}

function prepare(hull: Hull, o: V3): Prepared {
  const vertexCount = hull.vertices.length
  const faceCount = hull.faces.length
  const p = new Float64Array(3 * vertexCount)
  hull.vertices.forEach((v, i) => {
    p[3 * i] = v.x - o[0]
    p[3 * i + 1] = v.y - o[1]
    p[3 * i + 2] = v.z - o[2]
  })
  const n = new Float64Array(3 * faceCount)
  const d = new Float64Array(faceCount)
  hull.faces.forEach((face, f) => {
    const { x, y, z } = face.normal
    n[3 * f] = x
    n[3 * f + 1] = y
    n[3 * f + 2] = z
    d[f] = face.offset - (x * o[0] + y * o[1] + z * o[2])
  })
  return {
    hull,
    topo: topology(hull),
    p,
    n,
    d,
    centroid: sub(arr(hull.centroid), o),
    vertexCount,
    faceCount
  }
}

const vertexOf = (h: Prepared, i: number): V3 => [h.p[3 * i], h.p[3 * i + 1], h.p[3 * i + 2]]
const normalOf = (h: Prepared, f: number): V3 => [h.n[3 * f], h.n[3 * f + 1], h.n[3 * f + 2]]

// 면 f의 분리 min_꼭짓점 (n_f·q − d_f)와 그 꼭짓점(면 평면 offset 기준, P-L23 1: 선형 탐색, 같으면 작은 순번)
function faceSeparation(r: Prepared, other: Prepared, f: number): { sep: number; vertex: number } {
  const nx = r.n[3 * f]
  const ny = r.n[3 * f + 1]
  const nz = r.n[3 * f + 2]
  const d = r.d[f]
  const q = other.p
  let least = Infinity
  let vertex = 0
  for (let i = 0; i < other.vertexCount; i++) {
    const s = nx * q[3 * i] + ny * q[3 * i + 1] + nz * q[3 * i + 2] - d
    if (s < least) {
      least = s
      vertex = i
    }
  }
  return { sep: least, vertex }
}

type FaceQuery = { sep: number; face: number; vertex: number }

// r의 면마다 분리, 가장 큰 것(같으면 작은 순번). band를 넘는 면을 찾으면 바로 돌려준다(분리)
function faceQuery(r: Prepared, other: Prepared, band: number): FaceQuery {
  let best: FaceQuery = { sep: -Infinity, face: 0, vertex: 0 }
  for (let f = 0; f < r.faceCount; f++) {
    const { sep, vertex } = faceSeparation(r, other, f)
    if (sep > best.sep) {
      best = { sep, face: f, vertex }
      if (sep > band) return best
    }
  }
  return best
}

type EdgeAxis = { sep: number; axis: V3 }

// A 모서리 ea × B 모서리 eb의 축(Gauss 지도의 Minkowski 면 판정과 거의 나란한 짝 거르기를 지나야 한다). 축 u = normalize(e_A ×
// e_B)를 A 무게중심에서 바깥(A → B)으로 맞추고, 분리는 u·(q_B − q_A)다. 매니폴드 법선(B → A)은 −u(Box3D edgeQuery.normal =
// b3Neg(axis), convex_manifold.c:1430, P-L23 2)
function edgeAxis(a: Prepared, b: Prepared, ea: number, eb: number): EdgeAxis | null {
  const edgeA = a.hull.edges[ea]
  const edgeB = b.hull.edges[eb]
  const pA = vertexOf(a, edgeA.a)
  const eA = sub(vertexOf(a, edgeA.b), pA)
  const pB = vertexOf(b, edgeB.a)
  const eB = sub(vertexOf(b, edgeB.b), pB)
  const uA = normalOf(a, edgeA.left)
  const vA = normalOf(a, edgeA.right)
  const uB = normalOf(b, edgeB.left)
  const vB = normalOf(b, edgeB.right)
  // IsMinkowskiFace(Box3D :1395–1401의 꼴, 모서리 방향으로 쓴 Gregorius 판정)
  const cba = dot(uB, eA)
  const dba = dot(vB, eA)
  const adc = -dot(uA, eB)
  const bdc = -dot(vA, eB)
  if (!(cba * dba < 0 && adc * bdc < 0 && cba * bdc > 0)) return null
  if (
    Math.max(cba * cba, dba * dba) <
    PARALLEL_EDGE_TOLERANCE * PARALLEL_EDGE_TOLERANCE * dot(eA, eA)
  )
    return null
  let axis = normalize(cross(eA, eB))
  if (!axis) return null
  if (dot(axis, sub(pA, a.centroid)) < 0) axis = neg(axis)
  return { sep: dot(axis, sub(pB, pA)), axis }
}

type EdgeQuery = { sep: number; ea: number; eb: number; axis: V3 }

function edgeQuery(a: Prepared, b: Prepared, band: number): EdgeQuery | null {
  let best: EdgeQuery | null = null
  for (let ea = 0; ea < a.hull.edges.length; ea++)
    for (let eb = 0; eb < b.hull.edges.length; eb++) {
      const found = edgeAxis(a, b, ea, eb)
      if (!found) continue
      if (!best || found.sep > best.sep) {
        best = { sep: found.sep, ea, eb, axis: found.axis }
        if (found.sep > band) return best
      }
    }
  return best
}

// 접촉 점(옮긴 틀): 자리, 법선(B → A), 분리, 특징 id
type Pt = { p: V3; n: V3; sep: number; id: string }

// 자르기 꼭짓점: 들어오는·나가는 모서리와 그 주인(true = 기준 껍질의 옆 모서리, false = 사건 껍질 모서리)
type ClipVertex = { p: V3; inRef: boolean; inEdge: number; outRef: boolean; outEdge: number }

// Sutherland–Hodgman: 평면 n·x ≤ offset 쪽을 남긴다(Box3D b3ClipPolygon과 같은 꼴: 나가는 교점은 사건 모서리 → 기준 모서리, 들어오는
// 교점은 기준 모서리 → 사건 모서리)
function clipPolygon(poly: ClipVertex[], n: V3, offset: number, edge: number): ClipVertex[] {
  const out: ClipVertex[] = []
  let v1 = poly[poly.length - 1]
  let d1 = dot(n, v1.p) - offset
  for (const v2 of poly) {
    const d2 = dot(n, v2.p) - offset
    if (d1 <= 0 && d2 <= 0) out.push(v2)
    else if (d1 <= 0 && d2 > 0) {
      const t = d1 / (d1 - d2)
      out.push({
        p: add(v1.p, scale(sub(v2.p, v1.p), t)),
        inRef: v2.inRef,
        inEdge: v2.inEdge,
        outRef: true,
        outEdge: edge
      })
    } else if (d2 <= 0 && d1 > 0) {
      const t = d1 / (d1 - d2)
      out.push({
        p: add(v1.p, scale(sub(v2.p, v1.p), t)),
        inRef: true,
        inEdge: edge,
        outRef: v1.outRef,
        outEdge: v1.outEdge
      })
      out.push(v2)
    }
    v1 = v2
    d1 = d2
  }
  return out
}

// 점 id(부록 B): 사건 꼭짓점 v<들어오는 모서리>.<나가는 모서리>, 자른 교점 x<기준 옆 모서리>.<사건 모서리>. 기준 면 옆 모서리
// 둘이 만나는 점(사건 면이 기준 면 모서리를 덮을 때)은 x<들어오는>.r<나가는>이다 [결정: 부록 B에 없는 경우, 앞의 꼴과 겹치지 않게]
function clipId(v: ClipVertex): string {
  if (!v.inRef && !v.outRef) return `v${v.inEdge}.${v.outEdge}`
  if (v.inRef && v.outRef) return `x${v.inEdge}.r${v.outEdge}`
  return v.inRef ? `x${v.inEdge}.${v.outEdge}` : `x${v.outEdge}.${v.inEdge}`
}

// 면 접촉(§3.5 6): 기준 껍질 r의 면 f에 사건 껍질의 면(r 법선과 가장 반대인 면, 지지 꼭짓점에 닿은 면 가운데: Box3D 꼭짓점
// 안내식)을 옆 평면들로 자른다. 분리 s ≤ band인 점만, 자리는 p − ½·s·n. normal은 B → A(refIsA면 −n_f, 아니면 n_f)
function faceContact(
  r: Prepared,
  inc: Prepared,
  f: number,
  band: number,
  refIsA: boolean
): { points: Pt[]; normal: V3; tie: V3 } {
  const n = normalOf(r, f)
  const d = r.d[f]
  const normal = refIsA ? neg(n) : n
  const refFace = r.hull.faces[f].vertices
  const tieEdge = normalize(sub(vertexOf(r, refFace[1]), vertexOf(r, refFace[0]))) ?? [1, 0, 0]
  // 지지 꼭짓점(−n 방향, 같으면 작은 순번)과 그 꼭짓점의 면 가운데 n과 가장 반대인 면(같으면 작은 순번)
  let support = 0
  let least = Infinity
  for (let i = 0; i < inc.vertexCount; i++) {
    const s = dot(n, vertexOf(inc, i))
    if (s < least) {
      least = s
      support = i
    }
  }
  let incident = -1
  let incidentDot = Infinity
  for (const g of inc.topo.vertexFaces[support]) {
    const value = dot(normalOf(inc, g), n)
    if (value < incidentDot) {
      incidentDot = value
      incident = g
    }
  }
  const incFace = inc.hull.faces[incident].vertices
  const incEdges = inc.topo.faceEdges[incident]
  let poly: ClipVertex[] = incFace.map((v, k) => ({
    p: vertexOf(inc, v),
    inRef: false,
    inEdge: incEdges[(k + incFace.length - 1) % incFace.length],
    outRef: false,
    outEdge: incEdges[k]
  }))
  const refEdges = r.topo.faceEdges[f]
  for (let k = 0; k < refFace.length; k++) {
    const v1 = vertexOf(r, refFace[k])
    const v2 = vertexOf(r, refFace[(k + 1) % refFace.length])
    const side = normalize(cross(sub(v2, v1), n))
    if (!side) continue
    poly = clipPolygon(poly, side, dot(side, v1), refEdges[k])
    if (poly.length < 3) return { points: [], normal, tie: tieEdge }
  }
  const points: Pt[] = []
  for (const v of poly) {
    const s = dot(n, v.p) - d
    if (s > band) continue
    points.push({ p: sub(v.p, scale(n, s / 2)), n: normal, sep: s, id: clipId(v) })
  }
  return { points, normal, tie: tieEdge }
}

// 두 직선 p1 + s·e1, p2 + t·e2의 가장 가까운 매개변수(Ericson §5.1.8). 거의 나란하면 null
function lineParameters(p1: V3, e1: V3, p2: V3, e2: V3): { s: number; t: number } | null {
  const r = sub(p1, p2)
  const a = dot(e1, e1)
  const b = dot(e1, e2)
  const c = dot(e1, r)
  const e = dot(e2, e2)
  const f = dot(e2, r)
  const denom = a * e - b * b
  if (!(denom > 0)) return null
  return { s: (b * f - c * e) / denom, t: (a * f - b * c) / denom }
}

// 모서리 접촉(§3.5 7): 두 선분의 가장 가까운 점의 가운데에 점 하나(id e). 가장 가까운 점이 어느 선분 밖이면 null(꼭짓점–꼭짓점)
function edgeContact(a: Prepared, b: Prepared, ea: number, eb: number, axis: V3): Pt | null {
  const edgeA = a.hull.edges[ea]
  const edgeB = b.hull.edges[eb]
  const pA = vertexOf(a, edgeA.a)
  const eA = sub(vertexOf(a, edgeA.b), pA)
  const pB = vertexOf(b, edgeB.a)
  const eB = sub(vertexOf(b, edgeB.b), pB)
  const st = lineParameters(pA, eA, pB, eB)
  if (!st || st.s < 0 || st.s > 1 || st.t < 0 || st.t > 1) return null
  const q1 = add(pA, scale(eA, st.s))
  const q2 = add(pB, scale(eB, st.t))
  return { p: scale(add(q1, q2), 0.5), n: neg(axis), sep: dot(axis, sub(q2, q1)), id: 'e' }
}

// 점 줄이기(≤ 4점, Gregorius 2015·Box3D b3ReduceManifoldPoints): 1. 가장 깊은 점(같으면 tie 방향 지지가 큰 점, 그다음 작은 순번)
// 2. 그 점에서(법선에 수직인 평면에서) 가장 먼 점 3. 둘과 만드는 부호 넓이가 가장 큰 점 4. 그 삼각형 밖에 가장 큰 넓이를 더하는
// 점. 2–4는 Box3D의 0.95 순위 치우침을 쓴다. 점이 4개 이하면 그대로다(Box3D)
function reducePoints(points: Pt[], normal: V3, tie: V3): Pt[] {
  if (points.length <= MAX_MANIFOLD_POINTS) return points
  const rest = points.slice()
  let i0 = 0
  for (let i = 1; i < rest.length; i++) {
    const p = rest[i]
    const q = rest[i0]
    if (p.sep < q.sep || (p.sep === q.sep && dot(tie, p.p) > dot(tie, q.p))) i0 = i
  }
  const out: Pt[] = [rest[i0]]
  rest.splice(i0, 1)
  const tol2 = REDUCE_TOLERANCE * REDUCE_TOLERANCE
  const a = out[0].p
  // 2
  let best = 0
  let index = -1
  rest.forEach((pt, i) => {
    const d = sub(pt.p, a)
    const v = sub(d, scale(normal, dot(d, normal)))
    const score = dot(v, v)
    if (REDUCE_BIAS * score > best) {
      best = score
      index = i
    }
  })
  if (index < 0 || best < tol2) return out
  out.push(rest[index])
  rest.splice(index, 1)
  const b = out[1].p
  const ba = sub(b, a)
  // 3
  best = tol2
  index = -1
  let signedArea = 0
  rest.forEach((pt, i) => {
    const area = dot(normal, cross(ba, sub(pt.p, a)))
    if (REDUCE_BIAS * Math.abs(area) >= best) {
      best = Math.abs(area)
      index = i
      signedArea = area
    }
  })
  if (index < 0) return out
  out.push(rest[index])
  rest.splice(index, 1)
  const c = out[2].p
  // 4
  const sign = signedArea < 0 ? -1 : 1
  best = tol2
  index = -1
  rest.forEach((pt, i) => {
    const u1 = sign * dot(normal, cross(sub(pt.p, a), ba))
    const u2 = sign * dot(normal, cross(sub(pt.p, b), sub(c, b)))
    const u3 = sign * dot(normal, cross(sub(pt.p, c), sub(a, c)))
    const score = Math.max(u1, u2, u3)
    if (REDUCE_BIAS * score > best) {
      best = score
      index = i
    }
  })
  if (index >= 0) out.push(rest[index])
  return out
}

// 특징 하나(면 A·면 B·모서리 짝)와 그 분리
type FaceFeature =
  { kind: 'faceA'; face: number; sep: number } | { kind: 'faceB'; face: number; sep: number }
type EdgeFeature = { kind: 'edge'; ea: number; eb: number; sep: number; axis: V3 }
type Feature = FaceFeature | EdgeFeature

const sameFeature = (x: Feature, y: Feature): boolean => {
  if (x.kind === 'edge' || y.kind === 'edge')
    return x.kind === 'edge' && y.kind === 'edge' && x.ea === y.ea && x.eb === y.eb
  return x.kind === y.kind && x.face === y.face
}

const referenceOf = (feature: Feature): string =>
  feature.kind === 'faceA'
    ? `fa${feature.face}`
    : feature.kind === 'faceB'
      ? `fb${feature.face}`
      : `ee${feature.ea}.${feature.eb}`

// 기억한 특징의 지금 분리(모서리 짝이 더는 Minkowski 면이 아니면 null)
function cachedFeature(a: Prepared, b: Prepared, cache: NonNullable<SatCache>): Feature | null {
  if (cache.kind === 'faceA') {
    if (cache.a >= a.faceCount) return null
    return { kind: 'faceA', face: cache.a, sep: faceSeparation(a, b, cache.a).sep }
  }
  if (cache.kind === 'faceB') {
    if (cache.b >= b.faceCount) return null
    return { kind: 'faceB', face: cache.b, sep: faceSeparation(b, a, cache.b).sep }
  }
  if (cache.a >= a.hull.edges.length || cache.b >= b.hull.edges.length) return null
  const found = edgeAxis(a, b, cache.a, cache.b)
  return found ? { kind: 'edge', ea: cache.a, eb: cache.b, sep: found.sep, axis: found.axis } : null
}

const cacheOf = (feature: Feature, touching: boolean): NonNullable<SatCache> =>
  feature.kind === 'faceA'
    ? { kind: 'faceA', a: feature.face, b: 0, separation: feature.sep, touching }
    : feature.kind === 'faceB'
      ? { kind: 'faceB', a: 0, b: feature.face, separation: feature.sep, touching }
      : { kind: 'edge', a: feature.ea, b: feature.eb, separation: feature.sep, touching }

// 특징으로 접촉을 만든다. 모서리 접촉이 꼭짓점–꼭짓점이면(가장 가까운 점이 선분 밖) GJK로 점 하나(§3.6 껍질–껍질 GJK 대체):
// d > GJK_MIN_DISTANCE이고 d ≤ band일 때 법선 (p_A − p_B)/d, d ≤ GJK_MIN_DISTANCE면 그 모서리 축 법선으로 같은 자리에 점 하나
function buildFeature(
  a: Prepared,
  b: Prepared,
  feature: Feature,
  band: number
): { reference: string; normal: V3; tie: V3; points: Pt[] } {
  if (feature.kind === 'faceA' || feature.kind === 'faceB') {
    const refIsA = feature.kind === 'faceA'
    const built = refIsA
      ? faceContact(a, b, feature.face, band, true)
      : faceContact(b, a, feature.face, band, false)
    return { reference: referenceOf(feature), ...built }
  }
  const normal = neg(feature.axis)
  const point = edgeContact(a, b, feature.ea, feature.eb, feature.axis)
  if (point) return { reference: referenceOf(feature), normal, tie: [1, 0, 0], points: [point] }
  const gjk = gjkPoints(a, b)
  if (gjk.distance > GJK_MIN_DISTANCE) {
    if (gjk.distance > band) return { reference: 'gv', normal, tie: [1, 0, 0], points: [] }
    const n = scale(sub(gjk.pointA, gjk.pointB), 1 / gjk.distance)
    const p = scale(add(gjk.pointA, gjk.pointB), 0.5)
    return {
      reference: 'gv',
      normal: n,
      tie: [1, 0, 0],
      points: [{ p, n, sep: gjk.distance, id: 'g' }]
    }
  }
  const p = scale(add(gjk.pointA, gjk.pointB), 0.5)
  return {
    reference: 'gv',
    normal,
    tie: [1, 0, 0],
    points: [{ p, n: normal, sep: feature.sep, id: 'g' }]
  }
}

// 옮긴 틀의 GJK(두 껍질 꼭짓점)
function gjkPoints(a: Prepared, b: Prepared): { distance: number; pointA: V3; pointB: V3 } {
  const result = gjkArrays(pointsOf(a), pointsOf(b))
  return result
}

const pointsOf = (h: Prepared): V3[] =>
  Array.from({ length: h.vertexCount }, (_, i) => vertexOf(h, i))

type HullCollision = { manifold: Manifold | null; cache: SatCache; separation: number }

// A는 순서가 앞인 몸체, 정적은 늘 B. band는 짝의 예측 띠, cache는 짝의 기억(§3.5). 돌려주는 separation은 SAT 최선 분리(분리된
// 짝은 band를 넘는 처음 축의 값: 실제 거리의 하한)다
export function collideHulls(a: Hull, b: Hull, band: number, cache: SatCache): HullCollision {
  const o = arr(a.vertices[0])
  const A = prepare(a, o)
  const B = prepare(b, o)
  return collidePrepared(A, B, band, cache, o)
}

function finish(
  a: Prepared,
  b: Prepared,
  chosen: Feature,
  built: { reference: string; normal: V3; tie: V3; points: Pt[] },
  best: Feature,
  band: number,
  o: V3
): HullCollision {
  let points = built.points
  // 9. 참 분리 축 보충(4ab 교훈, fieldContact.ts SUPPLEMENT_TOLERANCE): 고른 특징이 SAT 최대 분리보다 덜 떨어졌고 최대가 면 축이면
  // 그 면의 점도 만든다(자기 법선, id 앞에 '+'와 그 면). 위치 보정이 없어 기준 면만으로는 거의 나란한 면이 짧은 면 끝을 넘어 걸칠
  // 때 침투가 남는다. 기억은 고른 특징 그대로다
  if (
    best.kind !== 'edge' &&
    best.sep > chosen.sep + SUPPLEMENT_TOLERANCE &&
    !sameFeature(best, chosen)
  ) {
    const extra = buildFeature(a, b, best, band)
    const tag = referenceOf(best)
    points = [...points, ...extra.points.map((pt) => ({ ...pt, id: `+${tag}.${pt.id}` }))]
  }
  points = reducePoints(points, built.normal, built.tie)
  const manifold: Manifold | null =
    points.length > 0
      ? {
          reference: built.reference,
          normal: vec(built.normal),
          points: points.map((pt) => ({
            position: vec(add(pt.p, o)),
            normal: vec(pt.n),
            separation: pt.sep,
            id: pt.id
          }))
        }
      : null
  return {
    manifold,
    cache: cacheOf(chosen, points.length > 0),
    separation: Math.max(best.sep, chosen.sep)
  }
}

function separated(feature: Feature): HullCollision {
  return { manifold: null, cache: cacheOf(feature, false), separation: feature.sep }
}

function collidePrepared(
  a: Prepared,
  b: Prepared,
  band: number,
  cache: SatCache,
  o: V3
): HullCollision {
  // 1. 기억 먼저
  const remembered = cache ? cachedFeature(a, b, cache) : null
  if (remembered && remembered.sep > band) return separated(remembered)
  if (
    cache &&
    remembered &&
    cache.touching &&
    Math.abs(remembered.sep - cache.separation) <= FEATURE_TOLERANCE
  ) {
    // 닿은 동안 기억이 맞으면 면 질의만 한다(모서리 질의 건너뛰기, P-L14)
    const fa = faceQuery(a, b, band)
    if (fa.sep > band) return separated({ kind: 'faceA', face: fa.face, sep: fa.sep })
    const fb = faceQuery(b, a, band)
    if (fb.sep > band) return separated({ kind: 'faceB', face: fb.face, sep: fb.sep })
    const faceMax: Feature =
      fb.sep > fa.sep
        ? { kind: 'faceB', face: fb.face, sep: fb.sep }
        : { kind: 'faceA', face: fa.face, sep: fa.sep }
    if (faceMax.sep <= remembered.sep + FEATURE_TOLERANCE) {
      const built = buildFeature(a, b, remembered, band)
      if (built.points.length > 0) {
        const best = faceMax.sep > remembered.sep ? faceMax : remembered
        return finish(a, b, remembered, built, best, band, o)
      }
    }
  }
  // 3–4. 전체 SAT
  const fa = faceQuery(a, b, band)
  const faceA: Feature = { kind: 'faceA', face: fa.face, sep: fa.sep }
  if (fa.sep > band) return separated(faceA)
  const fb = faceQuery(b, a, band)
  const faceB: Feature = { kind: 'faceB', face: fb.face, sep: fb.sep }
  if (fb.sep > band) return separated(faceB)
  const eq = edgeQuery(a, b, band)
  const edge: Feature | null = eq
    ? { kind: 'edge', ea: eq.ea, eb: eq.eb, sep: eq.sep, axis: eq.axis }
    : null
  if (edge && edge.sep > band) return separated(edge)
  let best: Feature = faceA
  if (faceB.sep > best.sep) best = faceB
  if (edge && edge.sep > best.sep) best = edge
  // 히스테리시스: 기억한 특징의 분리 ≥ 최선 − FEATURE_TOLERANCE이면 기억한 특징을 쓴다
  if (remembered && remembered.sep >= best.sep - FEATURE_TOLERANCE) {
    const built = buildFeature(a, b, remembered, band)
    if (built.points.length > 0) return finish(a, b, remembered, built, best, band, o)
  }
  // 5. 특징 고르기(절대 공차만): B 면은 A 면보다 FEATURE_TOLERANCE 넘게 클 때만
  let chosen: Feature = faceB.sep > faceA.sep + FEATURE_TOLERANCE ? faceB : faceA
  let built = buildFeature(a, b, chosen, band)
  if (edge) {
    const deepest = built.points.reduce((m, pt) => Math.min(m, pt.sep), Infinity)
    // 모서리로 바꾸는 것은 면 접촉이 비었고 모서리가 면보다 클 때, 또는 모서리가 면 접촉의 가장 깊은 점 분리보다 FEATURE_TOLERANCE
    // 넘게 클 때(Box3D clipSeparation = 자른 점의 최소 분리, convex_manifold.c:1567)
    if (
      (built.points.length === 0 && edge.sep > chosen.sep) ||
      edge.sep > deepest + FEATURE_TOLERANCE
    ) {
      const edgeBuilt = buildFeature(a, b, edge, band)
      if (edgeBuilt.points.length > 0 || built.points.length === 0) {
        chosen = edge
        built = edgeBuilt
      }
    }
  }
  return finish(a, b, chosen, built, best, band, o)
}

// ---- 둥근 짝과 GJK(§3.6) ----

// GJK 단체 꼭짓점: w = a[ia] − b[ib]
type SimplexVertex = { w: V3; ia: number; ib: number }
type SubSimplex = { simplex: SimplexVertex[]; lambda: number[] }

// 부호가 같다(0은 어느 쪽도 아님, Montanari 2017 compareSigns)
const sameSign = (x: number, y: number): boolean => (x > 0 && y > 0) || (x < 0 && y < 0)

const combine = (s: SubSimplex): V3 => {
  let v: V3 = [0, 0, 0]
  s.simplex.forEach((sv, i) => (v = add(v, scale(sv.w, s.lambda[i]))))
  return v
}

// 선분(s1 = 새 점): 원점의 사영이 선분 안이면 둘, 아니면 새 점 하나(Montanari S1D). 사영 축은 |t_k|가 가장 큰 축
function s1d(s: SimplexVertex[]): SubSimplex {
  const [s1, s2] = s
  const t = sub(s2.w, s1.w)
  const tt = dot(t, t)
  if (!(tt > 0)) return { simplex: [s1], lambda: [1] }
  const p0 = add(s1.w, scale(t, -dot(s1.w, t) / tt))
  let k = 0
  if (Math.abs(t[1]) > Math.abs(t[k])) k = 1
  if (Math.abs(t[2]) > Math.abs(t[k])) k = 2
  const mu = s1.w[k] - s2.w[k]
  const c1 = p0[k] - s2.w[k]
  const c2 = s1.w[k] - p0[k]
  if (sameSign(mu, c1) && sameSign(mu, c2)) return { simplex: [s1, s2], lambda: [c1 / mu, c2 / mu] }
  return { simplex: [s1], lambda: [1] }
}

// 후보 부분 단체 가운데 원점에 가장 가까운 것(같으면 앞의 것)
function closest(candidates: SubSimplex[]): SubSimplex {
  let best = candidates[0]
  let bestDistance = dot(combine(best), combine(best))
  for (let i = 1; i < candidates.length; i++) {
    const v = combine(candidates[i])
    const d = dot(v, v)
    if (d < bestDistance) {
      best = candidates[i]
      bestDistance = d
    }
  }
  return best
}

// 삼각형(s1 = 새 점): 평면 사영을 |n_k|가 가장 큰 축을 뺀 평면에서 부호 넓이로 가른다(Montanari S2D)
function s2d(s: SimplexVertex[]): SubSimplex {
  const [s1, s2, s3] = s
  const n = cross(sub(s2.w, s1.w), sub(s3.w, s1.w))
  const nn = dot(n, n)
  if (!(nn > 0)) return closest([s1d([s1, s2]), s1d([s1, s3])])
  const p0 = scale(n, dot(s1.w, n) / nn)
  let k = 0
  if (Math.abs(n[1]) > Math.abs(n[k])) k = 1
  if (Math.abs(n[2]) > Math.abs(n[k])) k = 2
  const i = (k + 1) % 3
  const j = (k + 2) % 3
  const area = (a: V3, b: V3, c: V3): number =>
    (b[i] - a[i]) * (c[j] - a[j]) - (b[j] - a[j]) * (c[i] - a[i])
  const mu = area(s1.w, s2.w, s3.w)
  const c = [area(p0, s2.w, s3.w), area(s1.w, p0, s3.w), area(s1.w, s2.w, p0)]
  if (c.every((x) => sameSign(mu, x)))
    return { simplex: [s1, s2, s3], lambda: c.map((x) => x / mu) }
  const candidates: SubSimplex[] = []
  // 꼭짓점 j 맞은편 모서리(s1과 남은 꼭짓점)
  if (!sameSign(mu, c[1])) candidates.push(s1d([s1, s3]))
  if (!sameSign(mu, c[2])) candidates.push(s1d([s1, s2]))
  return candidates.length > 0 ? closest(candidates) : closest([s1d([s1, s2]), s1d([s1, s3])])
}

const det3 = (a: V3, b: V3, c: V3): number => dot(a, cross(b, c))

// 사면체(s1 = 새 점): 4행 여인수로 원점의 무게중심 좌표, 맞은편 면이 보이는 면만 S2D(Montanari S3D)
function s3d(s: SimplexVertex[]): SubSimplex {
  const [s1, s2, s3, s4] = s
  const c = [
    -det3(s2.w, s3.w, s4.w),
    det3(s1.w, s3.w, s4.w),
    -det3(s1.w, s2.w, s4.w),
    det3(s1.w, s2.w, s3.w)
  ]
  const det = c[0] + c[1] + c[2] + c[3]
  if (c.every((x) => sameSign(det, x))) return { simplex: s, lambda: c.map((x) => x / det) }
  const faces = [
    [s1, s3, s4],
    [s1, s2, s4],
    [s1, s2, s3]
  ]
  const candidates: SubSimplex[] = []
  for (let k = 1; k < 4; k++) if (!sameSign(det, c[k])) candidates.push(s2d(faces[k - 1]))
  return candidates.length > 0 ? closest(candidates) : closest(faces.map(s2d))
}

// 지지 점(d·p 최대, 같으면 작은 순번)
function support(points: readonly V3[], d: V3): number {
  let best = 0
  let value = dot(points[0], d)
  for (let i = 1; i < points.length; i++) {
    const s = dot(points[i], d)
    if (s > value) {
      value = s
      best = i
    }
  }
  return best
}

function gjkArrays(
  a: readonly V3[],
  b: readonly V3[]
): { distance: number; pointA: V3; pointB: V3 } {
  let state: SubSimplex = { simplex: [{ w: sub(a[0], b[0]), ia: 0, ib: 0 }], lambda: [1] }
  let v = state.simplex[0].w
  for (let iteration = 0; iteration < GJK_MAX_ITERATIONS; iteration++) {
    const vv = dot(v, v)
    if (vv === 0) break
    const ia = support(a, neg(v))
    const ib = support(b, v)
    const w = sub(a[ia], b[ib])
    // 거리의 상한 |v|와 하한 v·w/|v|의 차가 GJK_TOLERANCE 아래면 끝
    if (vv - dot(v, w) <= GJK_TOLERANCE * Math.sqrt(vv)) break
    if (state.simplex.some((sv) => sv.ia === ia && sv.ib === ib)) break
    const next = [{ w, ia, ib }, ...state.simplex]
    const solved = next.length === 2 ? s1d(next) : next.length === 3 ? s2d(next) : s3d(next)
    const vNext = solved.simplex.length === 4 ? ([0, 0, 0] as V3) : combine(solved)
    // 반올림으로 더 가까워지지 않으면 앞 단체로 끝낸다(순환 막기)
    if (solved.simplex.length < 4 && !(dot(vNext, vNext) < vv)) break
    state = solved
    v = vNext
    if (solved.simplex.length === 4) break
  }
  let pointA: V3 = [0, 0, 0]
  let pointB: V3 = [0, 0, 0]
  state.simplex.forEach((sv, i) => {
    pointA = add(pointA, scale(a[sv.ia], state.lambda[i]))
    pointB = add(pointB, scale(b[sv.ib], state.lambda[i]))
  })
  const distance = state.simplex.length === 4 ? 0 : length(sub(pointA, pointB))
  return { distance, pointA, pointB }
}

// 점 집합 둘(볼록 껍질의 꼭짓점·선분 끝점·점 하나)의 거리와 가장 가까운 점. Montanari 2017 부호 부피식 부분 단체(결정적: 단체 점
// 순서 고정, 새 점을 앞에, 지지 점은 같으면 작은 순번)
export function gjkDistance(
  a: readonly Vec3[],
  b: readonly Vec3[]
): { distance: number; pointA: Vec3; pointB: Vec3 } {
  const result = gjkArrays(a.map(arr), b.map(arr))
  return { distance: result.distance, pointA: vec(result.pointA), pointB: vec(result.pointB) }
}

// 둥근 형상(캡슐 선분·구 점)과 반지름
type Round = { a: V3; b: V3; r: number; sphere: boolean }

// 선분 [p, q]를 껍질 면 f의 옆 평면들로 자른다(Box3D b3ClipSegmentToHullFace: 두 점이 다 남아야 한다). 점마다 원래 끝점 번호를 둔다
function clipSegmentToFace(
  hull: Prepared,
  f: number,
  p: V3,
  q: V3
): [{ p: V3; k: number }, { p: V3; k: number }] | null {
  const n = normalOf(hull, f)
  const face = hull.hull.faces[f].vertices
  let seg: { p: V3; k: number }[] = [
    { p, k: 0 },
    { p: q, k: 1 }
  ]
  for (let i = 0; i < face.length; i++) {
    const v1 = vertexOf(hull, face[i])
    const v2 = vertexOf(hull, face[(i + 1) % face.length])
    const side = normalize(cross(sub(v2, v1), n))
    if (!side) continue
    const offset = dot(side, v1)
    const d1 = dot(side, seg[0].p) - offset
    const d2 = dot(side, seg[1].p) - offset
    const out: { p: V3; k: number }[] = []
    if (d1 <= 0) out.push(seg[0])
    if (d2 <= 0) out.push(seg[1])
    if (d1 * d2 < 0) {
      const t = d1 / (d1 - d2)
      out.push({
        p: add(scale(seg[0].p, 1 - t), scale(seg[1].p, t)),
        k: d1 > 0 ? seg[0].k : seg[1].k
      })
    }
    if (out.length < 2) return null
    // 원래 순서(끝점 번호 순)를 지킨다
    seg = out[0].k <= out[1].k ? [out[0], out[1]] : [out[1], out[0]]
  }
  return [seg[0], seg[1]]
}

// 껍질–캡슐·구(Box3D b3CollideHullAndCapsule·b3CollideHullAndSphere). 법선은 껍질 → 캡슐로 낸 뒤 hullIsA면 뒤집어 B → A로 둔다.
// ① GJK(껍질 꼭짓점 ↔ 선분 끝점)로 거리 d. d > r + band면 접촉 없음 ② 얕음(d > GJK_MIN_DISTANCE): 캡슐은 δ 방향 지지 면이
// 거의 나란하면(|n·δ| > CAPSULE_FACE_PARALLEL) 그 면 옆 평면으로 선분을 잘라 2점(c0·c1), 아니면 가장 가까운 점 하나(gc/g)
// ③ 깊음: SAT 면 축(선분 지지 − r)과 껍질 모서리 × 선분 축, 면 접촉 2점, 모서리 축이 FEATURE_TOLERANCE 넘게 좋을 때만 모서리 1점
function collideHullRound(
  hull: Prepared,
  seg: Round,
  band: number,
  hullIsA: boolean,
  o: V3
): { manifold: Manifold | null; separation: number } {
  const r = seg.r
  const ends = seg.sphere ? [seg.a] : [seg.a, seg.b]
  const gjk = gjkArrays(pointsOf(hull), ends)
  const d = gjk.distance
  if (d > r + band) return { manifold: null, separation: d - r }
  const faceTag = hullIsA ? 'fa' : 'fb'
  const out = (reference: string, normal: V3, points: Pt[]): Manifold => {
    const flip = (n: V3): V3 => (hullIsA ? neg(n) : n)
    return {
      reference,
      normal: vec(flip(normal)),
      points: points.map((pt) => ({
        position: vec(add(pt.p, o)),
        normal: vec(flip(pt.n)),
        separation: pt.sep,
        id: pt.id
      }))
    }
  }
  if (d > GJK_MIN_DISTANCE) {
    // 껍질 → 캡슐
    const delta = scale(sub(gjk.pointB, gjk.pointA), 1 / d)
    if (!seg.sphere) {
      let ref = 0
      let bestDot = -Infinity
      for (let f = 0; f < hull.faceCount; f++) {
        const value = dot(normalOf(hull, f), delta)
        if (value > bestDot) {
          bestDot = value
          ref = f
        }
      }
      const n = normalOf(hull, ref)
      if (Math.abs(dot(n, delta)) > CAPSULE_FACE_PARALLEL) {
        const clipped = clipSegmentToFace(hull, ref, seg.a, seg.b)
        if (clipped) {
          const dist = clipped.map((c) => dot(n, c.p) - hull.d[ref])
          if (dist[0] <= r + band || dist[1] <= r + band) {
            const points = clipped.map((c, i) => ({
              p: sub(c.p, scale(n, (r + dist[i]) / 2)),
              n,
              sep: dist[i] - r,
              id: `c${c.k}`
            }))
            return {
              manifold: out(`${faceTag}${ref}`, n, points),
              separation: Math.min(points[0].sep, points[1].sep)
            }
          }
        }
      }
    }
    const p = scale(add(gjk.pointA, sub(gjk.pointB, scale(delta, r))), 0.5)
    return {
      manifold: out('gc', delta, [{ p, n: delta, sep: d - r, id: 'g' }]),
      separation: d - r
    }
  }
  // 깊음: SAT 면 축(선분 지지 − r)
  let face = 0
  let faceSep = -Infinity
  for (let f = 0; f < hull.faceCount; f++) {
    const n = normalOf(hull, f)
    let least = Infinity
    for (const e of ends) least = Math.min(least, dot(n, e) - hull.d[f])
    if (least - r > faceSep) {
      faceSep = least - r
      face = f
    }
  }
  if (faceSep > band) return { manifold: null, separation: faceSep }
  const n = normalOf(hull, face)
  if (seg.sphere) {
    const dist = dot(n, seg.a) - hull.d[face]
    const p = sub(seg.a, scale(n, (r + dist) / 2))
    return {
      manifold: out(`${faceTag}${face}`, n, [{ p, n, sep: dist - r, id: 'g' }]),
      separation: dist - r
    }
  }
  // 껍질 모서리 × 선분 축(Box3D b3QueryEdgeDirectionHullAndCapsule: 고립된 모서리는 Gauss 지도의 원점 지나는 원)
  const eSeg = sub(seg.b, seg.a)
  let edge = -1
  let edgeSep = -Infinity
  let edgeNormal: V3 = [0, 0, 1]
  hull.hull.edges.forEach((e, index) => {
    const uB = normalOf(hull, e.left)
    const vB = normalOf(hull, e.right)
    const cba = dot(uB, eSeg)
    const dba = dot(vB, eSeg)
    if (!(cba * dba < 0)) return
    if (
      Math.max(cba * cba, dba * dba) <
      PARALLEL_EDGE_TOLERANCE * PARALLEL_EDGE_TOLERANCE * dot(eSeg, eSeg)
    )
      return
    const t = cba / (cba - dba)
    const axis = normalize(add(uB, scale(sub(vB, uB), t)))
    if (!axis) return
    const sep = dot(axis, sub(seg.b, vertexOf(hull, e.b))) - r
    if (sep > edgeSep) {
      edgeSep = sep
      edge = index
      edgeNormal = axis
    }
  })
  if (edgeSep > band) return { manifold: null, separation: edgeSep }
  let points: Pt[] = []
  let clippedSep = faceSep
  const clipped = clipSegmentToFace(hull, face, seg.a, seg.b)
  if (clipped) {
    points = clipped.map((c) => {
      const dist = dot(n, c.p) - hull.d[face]
      return { p: sub(c.p, scale(n, (r + dist) / 2)), n, sep: dist - r, id: `c${c.k}` }
    })
    clippedSep = Math.min(points[0].sep, points[1].sep)
  }
  if (edge >= 0 && (points.length === 0 || edgeSep > clippedSep + FEATURE_TOLERANCE)) {
    const e = hull.hull.edges[edge]
    const ph = vertexOf(hull, e.a)
    const eh = sub(vertexOf(hull, e.b), ph)
    const st = lineParameters(ph, eh, seg.a, eSeg)
    if (st && st.s >= 0 && st.s <= 1 && st.t >= 0 && st.t <= 1) {
      const q1 = add(ph, scale(eh, st.s))
      const q2 = add(seg.a, scale(eSeg, st.t))
      const sep = dot(edgeNormal, sub(q2, q1)) - r
      const p = scale(add(q1, sub(q2, scale(edgeNormal, r))), 0.5)
      return {
        manifold: out(`ee${edge}.s`, edgeNormal, [{ p, n: edgeNormal, sep, id: 'ce' }]),
        separation: Math.max(faceSep, edgeSep)
      }
    }
  }
  if (points.length === 0) return { manifold: null, separation: Math.max(faceSep, edgeSep) }
  return {
    manifold: out(`${faceTag}${face}`, n, points),
    separation: Math.max(faceSep, edgeSep)
  }
}

// 선분 둘의 가장 가까운 점(Ericson §5.1.9 ClosestPtSegmentSegment). 구(점)는 방향 0으로 다룬다
function closestSegments(
  p1: V3,
  q1: V3,
  sphere1: boolean,
  p2: V3,
  q2: V3,
  sphere2: boolean
): { c1: V3; c2: V3 } {
  const d1: V3 = sphere1 ? [0, 0, 0] : sub(q1, p1)
  const d2: V3 = sphere2 ? [0, 0, 0] : sub(q2, p2)
  const r = sub(p1, p2)
  const a = dot(d1, d1)
  const e = dot(d2, d2)
  const f = dot(d2, r)
  let s = 0
  let t = 0
  const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
  if (a === 0 && e === 0) {
    s = 0
    t = 0
  } else if (a === 0) {
    t = clamp01(f / e)
  } else {
    const c = dot(d1, r)
    if (e === 0) {
      s = clamp01(-c / a)
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      s = denom > 0 ? clamp01((b * f - c * e) / denom) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp01(-c / a)
      } else if (t > 1) {
        t = 1
        s = clamp01((b - c) / a)
      }
    }
  }
  return { c1: add(p1, scale(d1, s)), c2: add(p2, scale(d2, t)) }
}

// d에 수직인 단위 축: |d_k|가 가장 작은 필드 축(같으면 작은 k)과의 외적
function perpendicularTo(d: V3): V3 {
  let k = 0
  if (Math.abs(d[1]) < Math.abs(d[k])) k = 1
  if (Math.abs(d[2]) < Math.abs(d[k])) k = 2
  const e: V3 = [0, 0, 0]
  e[k] = 1
  return normalize(cross(d, e)) ?? [0, 0, 1]
}

// 캡슐–캡슐(Box3D b3CollideCapsules, 둘 다 구면 점 둘): 가장 가까운 점의 거리가 GJK_MIN_DISTANCE보다 크면 그 방향, 교차하면
// normalize(d_A × d_B)를 무게중심 차로 B → A에 맞춘다(나란하면 d_A에 수직인 축). 거의 나란하면(사인 < 0.005) B 선분을 A 끝
// 평면으로 잘라 2점(Gregorius 2015 "parallel capsules")
function collideCapsules(
  A: Round,
  B: Round,
  band: number
): { manifold: Manifold | null; separation: number } {
  const radius = A.r + B.r
  const { c1, c2 } = closestSegments(A.a, A.b, A.sphere, B.a, B.b, B.sphere)
  const offset = sub(c1, c2)
  const distance = length(offset)
  if (distance > radius + band) return { manifold: null, separation: distance - radius }
  const dA = A.sphere ? ([0, 0, 0] as V3) : sub(A.b, A.a)
  const dB = B.sphere ? ([0, 0, 0] as V3) : sub(B.b, B.a)
  const point = (pt: V3, n: V3, sep: number, id: string): ManifoldPoint => ({
    position: vec(pt),
    normal: vec(n),
    separation: sep,
    id
  })
  if (!A.sphere && !B.sphere) {
    const lA = length(dA)
    const lB = length(dB)
    const eA = scale(dA, 1 / lA)
    const sine = length(cross(eA, scale(dB, 1 / lB)))
    if (sine < PARALLEL_CAPSULE_SINE) {
      // B 끝점을 A 끝 평면 eA·x ≥ eA·A.a, eA·x ≤ eA·A.b로 자른다(나간 끝점의 번호를 그 교점이 갖는다)
      let seg: { p: V3; k: number }[] = [
        { p: B.a, k: 0 },
        { p: B.b, k: 1 }
      ]
      const planes: { n: V3; offset: number }[] = [
        { n: neg(eA), offset: -dot(eA, A.a) },
        { n: eA, offset: dot(eA, A.b) }
      ]
      for (const plane of planes) {
        if (seg.length < 2) break
        const d1 = dot(plane.n, seg[0].p) - plane.offset
        const d2 = dot(plane.n, seg[1].p) - plane.offset
        const out: { p: V3; k: number }[] = []
        if (d1 <= 0) out.push(seg[0])
        if (d2 <= 0) out.push(seg[1])
        if (d1 * d2 < 0) {
          const t = d1 / (d1 - d2)
          out.push({
            p: add(scale(seg[0].p, 1 - t), scale(seg[1].p, t)),
            k: d1 > 0 ? seg[0].k : seg[1].k
          })
        }
        seg = out.length === 2 && out[0].k > out[1].k ? [out[1], out[0]] : out
      }
      if (seg.length === 2) {
        const near = seg.map((s) => {
          const t = Math.min(1, Math.max(0, dot(sub(s.p, A.a), dA) / (lA * lA)))
          const cp = add(A.a, scale(dA, t))
          return { s, cp, distance: length(sub(s.p, cp)) }
        })
        if (near.every((x) => x.distance > GJK_MIN_DISTANCE && x.distance <= radius + band)) {
          // A → B 법선(점마다와 평균)
          const ns = near.map((x) => scale(sub(x.s.p, x.cp), 1 / x.distance))
          const nAvg = normalize(add(ns[0], ns[1]))
          if (nAvg) {
            const normal = neg(nAvg)
            const points = near.map((x, i) =>
              point(
                scale(add(add(x.cp, scale(ns[i], A.r)), sub(x.s.p, scale(ns[i], B.r))), 0.5),
                neg(ns[i]),
                x.distance - radius,
                `c${x.s.k}`
              )
            )
            return {
              manifold: { reference: 'cc', normal: vec(normal), points },
              separation: Math.min(points[0].separation, points[1].separation)
            }
          }
        }
      }
    }
  }
  let normal: V3
  if (distance > GJK_MIN_DISTANCE) normal = scale(offset, 1 / distance)
  else {
    const n = normalize(cross(dA, dB))
    const d = length(dA) > 0 ? dA : dB
    normal = n ?? (length(d) > 0 ? perpendicularTo(d) : [0, 0, 1])
    const centerA = scale(add(A.a, A.b), 0.5)
    const centerB = scale(add(B.a, B.b), 0.5)
    if (dot(normal, sub(centerA, centerB)) < 0) normal = neg(normal)
  }
  const p = scale(add(sub(c1, scale(normal, A.r)), add(c2, scale(normal, B.r))), 0.5)
  return {
    manifold: {
      reference: 'cc',
      normal: vec(normal),
      points: [point(p, normal, distance - radius, 'c')]
    },
    separation: distance - radius
  }
}

// 껍질–바닥(z = 0, 법선 +z): z ≤ band인 꼭짓점(4점까지, §3.5 8), id v<꼭짓점>
function collideHullFloor(
  hull: Hull,
  band: number
): { manifold: Manifold | null; separation: number } {
  let lowest = Infinity
  const points: Pt[] = []
  hull.vertices.forEach((v, i) => {
    lowest = Math.min(lowest, v.z)
    if (v.z > band) return
    points.push({ p: [v.x, v.y, v.z / 2], n: [0, 0, 1], sep: v.z, id: `v${i}` })
  })
  if (points.length === 0) return { manifold: null, separation: lowest }
  const kept = reducePoints(points, [0, 0, 1], [1, 0, 0])
  return {
    manifold: {
      reference: 'fl',
      normal: { x: 0, y: 0, z: 1 },
      points: kept.map((pt) => ({
        position: vec(pt.p),
        normal: { x: 0, y: 0, z: 1 },
        separation: pt.sep,
        id: pt.id
      }))
    },
    separation: lowest
  }
}

// 캡슐–바닥: z − r ≤ band인 끝점(0–2, 구는 1), id e0·e1
function collideRoundFloor(
  seg: Round,
  band: number
): { manifold: Manifold | null; separation: number } {
  const ends = seg.sphere ? [seg.a] : [seg.a, seg.b]
  let lowest = Infinity
  const points: ManifoldPoint[] = []
  ends.forEach((e, i) => {
    const sep = e[2] - seg.r
    lowest = Math.min(lowest, sep)
    if (sep > band) return
    points.push({
      position: vec([e[0], e[1], sep / 2]),
      normal: { x: 0, y: 0, z: 1 },
      separation: sep,
      id: `e${i}`
    })
  })
  if (points.length === 0) return { manifold: null, separation: lowest }
  return {
    manifold: { reference: 'fl', normal: { x: 0, y: 0, z: 1 }, points },
    separation: lowest
  }
}

const roundOf = (s: Extract<PlacedShape, { kind: 'capsule' }>): Round => ({
  a: arr(s.a),
  b: arr(s.b),
  r: s.r,
  sphere: s.sphere
})

// 짝 하나의 좁은 단계(bodyCollision.ts가 부른다): A는 앞 몸체의 형상, B는 다른 몸체·정적 형상이거나 바닥(null). 껍질–껍질은 SAT와
// 기억, 둥근 형상이 든 짝은 GJK가 먼저다(기억은 쓰지 않고 그대로 돌려준다)
export function collideShapes(
  a: PlacedShape,
  b: PlacedShape | null,
  band: number,
  cache: SatCache
): HullCollision {
  if (b === null) {
    const result =
      a.kind === 'hull' ? collideHullFloor(a.hull, band) : collideRoundFloor(roundOf(a), band)
    return { ...result, cache: null }
  }
  if (a.kind === 'hull' && b.kind === 'hull') return collideHulls(a.hull, b.hull, band, cache)
  if (a.kind === 'capsule' && b.kind === 'capsule') {
    return { ...collideCapsules(roundOf(a), roundOf(b), band), cache: null }
  }
  const hull = a.kind === 'hull' ? a.hull : (b as Extract<PlacedShape, { kind: 'hull' }>).hull
  const round = roundOf((a.kind === 'capsule' ? a : b) as Extract<PlacedShape, { kind: 'capsule' }>)
  const o = arr(hull.vertices[0])
  const prepared = prepare(hull, o)
  const result = collideHullRound(
    prepared,
    { a: sub(round.a, o), b: sub(round.b, o), r: round.r, sphere: round.sphere },
    band,
    a.kind === 'hull',
    o
  )
  return { ...result, cache: null }
}

// ---- 겹침 깊이와 편집 자세 앞 계산(§3.7) ----

// SAT 최선 분리(모든 면·모서리 축, 일찍 끝내지 않음)
function satSeparation(a: Prepared, b: Prepared): number {
  const fa = faceQuery(a, b, Infinity)
  const fb = faceQuery(b, a, Infinity)
  const eq = edgeQuery(a, b, Infinity)
  return Math.max(fa.sep, fb.sep, eq?.sep ?? -Infinity)
}

// 두 형상(같은 틀)의 분리(음수 = 겹침 깊이). 껍질–껍질은 SAT 최선 분리, 둥근 짝은 GJK 거리 − 반지름(깊으면 SAT 축)
export function shapeSeparation(a: PlacedShape, b: PlacedShape): number {
  if (a.kind === 'hull' && b.kind === 'hull') {
    const o = arr(a.hull.vertices[0])
    return satSeparation(prepare(a.hull, o), prepare(b.hull, o))
  }
  if (a.kind === 'capsule' && b.kind === 'capsule') {
    const A = roundOf(a)
    const B = roundOf(b)
    const { c1, c2 } = closestSegments(A.a, A.b, A.sphere, B.a, B.b, B.sphere)
    return length(sub(c1, c2)) - A.r - B.r
  }
  const hull = a.kind === 'hull' ? a.hull : (b as Extract<PlacedShape, { kind: 'hull' }>).hull
  const round = roundOf((a.kind === 'capsule' ? a : b) as Extract<PlacedShape, { kind: 'capsule' }>)
  const o = arr(hull.vertices[0])
  const prepared = prepare(hull, o)
  return collideHullRound(
    prepared,
    { a: sub(round.a, o), b: sub(round.b, o), r: round.r, sphere: round.sphere },
    Infinity,
    true,
    o
  ).separation
}

// 형상의 축 정렬 상자(캡슐은 끝점 ± r)
export function shapeBounds(shape: PlacedShape): { min: V3; max: V3 } {
  if (shape.kind === 'hull') {
    const min: V3 = [Infinity, Infinity, Infinity]
    const max: V3 = [-Infinity, -Infinity, -Infinity]
    for (const v of shape.hull.vertices) {
      const p = arr(v)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k])
        max[k] = Math.max(max[k], p[k])
      }
    }
    return { min, max }
  }
  const a = arr(shape.a)
  const b = arr(shape.b)
  return {
    min: [0, 1, 2].map((k) => Math.min(a[k], b[k]) - shape.r) as V3,
    max: [0, 1, 2].map((k) => Math.max(a[k], b[k]) + shape.r) as V3
  }
}

// 두 상자가 축마다 margin 넘게 겹치는지(겹친 폭 > margin; margin이 음수면 그만큼 떨어져도 참)
function boundsOverlap(a: { min: V3; max: V3 }, b: { min: V3; max: V3 }, margin: number): boolean {
  for (let k = 0; k < 3; k++)
    if (!(Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > margin)) return false
  return true
}

// body: −1 섀시, ≥ 0 세계 설명 관절 순번. parent: 관절 몸체의 부모 몸체(섀시 −1의 parent는 −2: 짝이 없음). frame: 로봇 좌표의
// 몸체 틀(섀시는 단위). colliders: 켠 충돌체(몸체 틀)
export type EditPoseBody = {
  body: number
  parent: number
  frame: Frame3
  colliders: readonly SimCollider[]
}
export type EditPoseOverlap = { a: number; b: number; depth: number }

type PlacedCollider = { shape: PlacedShape; bounds: { min: V3; max: V3 } }

function placeColliders(colliders: readonly SimCollider[], frame: Frame3): PlacedCollider[] {
  const out: PlacedCollider[] = []
  for (const c of colliders) {
    const shape = bodyShape(c)
    if (!shape) continue
    const placed = placeShape(shape, frame)
    out.push({ shape: placed, bounds: shapeBounds(placed) })
  }
  return out
}

// 바로 붙은 부모–자식이 아닌 몸체 짝(a < b) 가운데 충돌체 짝 하나라도 분리 < −tolerance인 것. depth = −min 분리.
// 순서: (a, b) 사전순. 같은 몸체·인접 짝은 형상 전에 빼고, 충돌체 짝마다 축 정렬 상자가 tolerance 넘게 겹칠 때만 분리를 잰다(겹침
// 깊이가 tolerance를 넘으면 상자도 축마다 그만큼 겹친다)
export function editPoseOverlaps(
  bodies: readonly EditPoseBody[],
  tolerance: number = EDIT_OVERLAP_TOLERANCE
): EditPoseOverlap[] {
  const placed = bodies.map((b) => placeColliders(b.colliders, b.frame))
  const out: EditPoseOverlap[] = []
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const x = bodies[i]
      const y = bodies[j]
      if (x.body === y.body || x.parent === y.body || y.parent === x.body) continue
      let least = Infinity
      for (const p of placed[i])
        for (const q of placed[j]) {
          if (!boundsOverlap(p.bounds, q.bounds, tolerance)) continue
          least = Math.min(least, shapeSeparation(p.shape, q.shape))
        }
      if (least < -tolerance)
        out.push({ a: Math.min(x.body, y.body), b: Math.max(x.body, y.body), depth: -least })
    }
  return out.sort((p, q) => p.a - q.a || p.b - q.b)
}

// ---- 시작 겹침(§3.8) ----

export type StartBodyOverlap = { body: number; targets: (FieldOverlap | { kind: 'floor' })[] }

// 세계 설명 시작 자세(관절 q = 0)에서 몸체 형상과 정적 형상(§3.2 규칙)의 분리 < −EDIT_OVERLAP_TOLERANCE인 것.
// 섀시는 wheels가 있을 때만(바닥 제외), 관절 몸체는 늘. 몸체 순서(섀시, 관절 0…), 대상은 staticShapes 순서. 축 정렬 상자 넓은
// 단계 먼저. 형상이 없는 세계는 [](bodyCollision.ts bodyCollisionNeeded와 같은 조건)
export function startOverlaps(spec: WorldSpec, field: FieldSpec): StartBodyOverlap[] {
  const needed =
    spec.robot.colliders !== undefined || spec.joints.some((j) => (j.colliders?.length ?? 0) > 0)
  if (!needed) return []
  const statics = staticShapes(field).map((s) => ({
    s,
    bounds: s.hull ? shapeBounds({ kind: 'hull', hull: s.hull }) : null
  }))
  const chassis = planarFrame(spec.robot.start)
  const joints =
    spec.joints.length > 0
      ? new Articulation(spec.joints).bodyPoses().map((pose) => composeFrames(chassis, pose))
      : []
  const tolerance = EDIT_OVERLAP_TOLERANCE
  const out: StartBodyOverlap[] = []
  const check = (
    body: number,
    colliders: readonly SimCollider[],
    frame: Frame3,
    isChassis: boolean
  ): void => {
    const placed = placeColliders(colliders, frame)
    if (placed.length === 0) return
    const targets: StartBodyOverlap['targets'] = []
    for (const { s, bounds } of statics) {
      if (isChassis ? !s.chassis : !s.joints) continue
      let overlapped = false
      for (const p of placed) {
        if (s.kind === 'floor') {
          if (p.bounds.min[2] < -tolerance) overlapped = true
        } else if (
          bounds &&
          boundsOverlap(p.bounds, bounds, tolerance) &&
          shapeSeparation(p.shape, { kind: 'hull', hull: s.hull as Hull }) < -tolerance
        )
          overlapped = true
        if (overlapped) break
      }
      if (overlapped) targets.push(s.target)
    }
    if (targets.length > 0) out.push({ body, targets })
  }
  if (spec.robot.colliders !== undefined && spec.wheels.length > 0)
    check(-1, spec.robot.colliders, chassis, true)
  spec.joints.forEach((j, i) => {
    if (j.colliders && j.colliders.length > 0) check(i, j.colliders, joints[i], false)
  })
  return out
}
