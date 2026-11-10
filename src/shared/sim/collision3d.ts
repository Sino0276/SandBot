import type { Hull } from './hull'
import type { FieldOverlap } from './seasons/fieldGeometry'
import type { FieldSpec } from './seasons/fieldSpec'
import type { Frame3 } from './sensorFrame'
import type { SimCollider, Vec3, WorldSpec } from './worldSpec'

// 3D 충돌 형상과 좁은 단계(spec-5 §3): 필드 정적 형상, 몸체 형상, 세운 원기둥 근사, 볼록 껍질 SAT + 자르기, 둥근 형상(캡슐·구)의
// GJK, 편집 자세 겹침 앞 계산, 시작 겹침. 순수 TS이고 결정적이다(배열 순서만 쓰고, 같으면 작은 순번).
//
// 계약 커밋: 상수·타입·서명만 있다. staticShapes·bodyShape·placeShape·cylinderPrism·collideHulls·gjkDistance·
// shapeSeparation은 던지고, editPoseOverlaps·startOverlaps는 빈 목록이다. 5 A가 구현한다.

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

// 순서: 벽 넷 → 구조물(배열 순번 순, 규칙에 맞는 것) → 바닥. 얼린 FieldSpec마다 하나, 결과는 깊게 얼린다
export function staticShapes(field: FieldSpec): readonly StaticShape[] {
  void field
  throw new Error('5-A')
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

// convex → canonicalHull(points), box → boxHull(center, rotation, half), capsule → sphere = |b − a| < MIN_CAPSULE_SEGMENT
export function bodyShape(collider: SimCollider): BodyShape | null {
  void collider
  throw new Error('5-A')
}

// 같은 틀에 놓인 형상(편집 자세·시작 겹침·SAT 입력). 캡슐은 선분 + 반지름
export type PlacedShape =
  { kind: 'hull'; hull: Hull } | { kind: 'capsule'; a: Vec3; b: Vec3; r: number; sphere: boolean }

// 몸체 틀 → 그 틀의 부모(로봇 좌표·C)
export function placeShape(shape: BodyShape, frame: Frame3): PlacedShape {
  void shape
  void frame
  throw new Error('5-A')
}

// ---- 세운 원기둥 = 외접 16각 기둥(§3.4) ----

// 32점(아래 16 반시계 + 위 16). 꼭짓점 각 k·22.5°, 반지름 r / cos(11.25°). cos·sin은 제곱근 식만 쓴다(새 Math.sin·cos 없음)
export function cylinderPrism(
  center: Vec3,
  rotation: Vec3,
  radius: number,
  height: number
): Vec3[] {
  void center
  void rotation
  void radius
  void height
  throw new Error('5-A')
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

// A는 순서가 앞인 몸체, 정적은 늘 B. band는 짝의 예측 띠, cache는 짝의 기억
export function collideHulls(
  a: Hull,
  b: Hull,
  band: number,
  cache: SatCache
): { manifold: Manifold | null; cache: SatCache; separation: number } {
  void a
  void b
  void band
  void cache
  throw new Error('5-A')
}

// ---- 둥근 짝과 GJK(§3.6) ----

// 점 집합 둘(볼록 껍질의 꼭짓점·선분 끝점·점 하나)의 거리와 가장 가까운 점. Montanari 2017 부호 부피식 부분 단체(결정적: 단체
// 순서 고정)
export function gjkDistance(
  a: readonly Vec3[],
  b: readonly Vec3[]
): { distance: number; pointA: Vec3; pointB: Vec3 } {
  void a
  void b
  throw new Error('5-A')
}

// ---- 겹침 깊이와 편집 자세 앞 계산(§3.7) ----

// 두 형상(같은 틀)의 분리(음수 = 겹침 깊이). 껍질–껍질은 SAT 최선 분리, 둥근 짝은 GJK 거리 − 반지름(깊으면 SAT 축)
export function shapeSeparation(a: PlacedShape, b: PlacedShape): number {
  void a
  void b
  throw new Error('5-A')
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

// 바로 붙은 부모–자식이 아닌 몸체 짝(a < b) 가운데 충돌체 짝 하나라도 분리 < −tolerance인 것. depth = −min 분리.
// 순서: (a, b) 사전순. 같은 몸체·인접 짝은 형상 전에 빼고, 충돌체 짝마다 축 정렬 상자가 tolerance 넘게 겹칠 때만 분리를 잰다
export function editPoseOverlaps(
  bodies: readonly EditPoseBody[],
  tolerance: number = EDIT_OVERLAP_TOLERANCE
): EditPoseOverlap[] {
  void bodies
  void tolerance
  return []
}

// ---- 시작 겹침(§3.8) ----

export type StartBodyOverlap = { body: number; targets: (FieldOverlap | { kind: 'floor' })[] }

// 세계 설명 시작 자세(관절 q = 0)에서 몸체 형상과 정적 형상(§3.2 규칙)의 분리 < −EDIT_OVERLAP_TOLERANCE인 것.
// 섀시는 wheels가 있을 때만(바닥 제외), 관절 몸체는 늘. 몸체 순서(섀시, 관절 0…), 대상은 staticShapes 순서. 축 정렬 상자 넓은
// 단계 먼저. 형상이 없는 세계는 []
export function startOverlaps(spec: WorldSpec, field: FieldSpec): StartBodyOverlap[] {
  void spec
  void field
  return []
}
