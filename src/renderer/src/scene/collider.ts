import { HULL_DEFAULT_VERTEX_LIMIT, MAX_HULL_POINTS } from '../../../shared/sim/hull'
import {
  DEFAULT_COLLIDER_FRICTION,
  MAX_CAPSULE_RADIUS,
  MAX_COLLIDER_FRICTION,
  MIN_BOX_SIZE,
  MIN_CAPSULE_RADIUS
} from '../../../shared/sim/worldSpec'
import type { SceneObject, Vec3 as Vec3T } from './model'

// 충돌체(Unity Collider, spec-5 §2.1, PROJECT_VERSION 13). 시뮬레이터 설정이라 생성 코드·구성 XML·하드웨어 검증·사용처와
// 관계없다(바퀴·관절과 같은 원칙). 틀은 그 오브젝트의 로컬 틀(피벗, 자기 축)이고 길이는 m다(표시 단위 변환은 인스펙터에서만).
// Vec3T는 scene/model.ts의 [x, y, z] 튜플이다(shared의 {x, y, z}와 다르다).

export type ColliderDirection = 'x' | 'y' | 'z'
type ColliderBase = {
  // UUID(카드 key, 편집 대상). 한 오브젝트 안에서 유일
  id: string
  // Unity Collider.enabled. 끈 것만 false로 두고(키 없음 = 켬), 끈 Collider도 "있음"으로 센다(자동 껍질을 끔, spec-5 §1.2)
  enabled?: false
  // [0, MAX_COLLIDER_FRICTION]. 없으면 DEFAULT_COLLIDER_FRICTION(인스펙터 빈 칸)
  friction?: number
}
export type BoxColliderSettings = ColliderBase & {
  kind: 'box'
  center: Vec3T
  size: Vec3T
}
export type CapsuleColliderSettings = ColliderBase & {
  kind: 'capsule'
  center: Vec3T
  radius: number
  // 반구 포함 전체 높이(Unity). 2·radius보다 작으면 구
  height: number
  direction: ColliderDirection
}
export type MeshColliderSettings = ColliderBase & {
  kind: 'mesh'
  // 볼록 껍질 꼭짓점 한도(정수)
  vertexLimit: number
}
export type ColliderSettings = BoxColliderSettings | CapsuleColliderSettings | MeshColliderSettings
export type ColliderKind = ColliderSettings['kind']

// 로봇의 자기 충돌 설정(robot에만). forceCollide: 편집 자세 겹침으로 무시할 몸체 짝 가운데 그래도 충돌시킬 짝.
// 몸체 오브젝트 id(섀시 = 로봇 id, 관절 몸체 = 관절 오브젝트 id) 둘, 짝 안에서 사전순, 목록도 사전순·중복 없음.
// 끊긴 id(지운 관절)는 남긴다(실행 취소·되살림, 빌더가 무시).
export type RobotCollisionSettings = { forceCollide: [string, string][] }

export const COLLIDER_KINDS: readonly ColliderKind[] = ['box', 'capsule', 'mesh']
export const COLLIDER_DIRECTIONS: readonly ColliderDirection[] = ['x', 'y', 'z']

// 한 오브젝트의 Collider 수 [결정: 몸체 16 한도 아래에서 부품마다 몇 개]
export const MAX_OBJECT_COLLIDERS = 8
// center 성분 |c|와 size의 위 한도(m, 세계 설명 MAX_COORD와 같다). height는 그 두 배까지(아래 sanitizeCollider)
export const MAX_COLLIDER_EXTENT = 10
// 상자 크기 하한(각 축)·캡슐 반지름 한도·마찰 한도·기본 마찰은 세계 설명과 같은 값을 다시 내보낸다(한곳:
// src/shared/sim/worldSpec.ts, spec-5 C-H2)
export {
  DEFAULT_COLLIDER_FRICTION,
  MAX_CAPSULE_RADIUS,
  MAX_COLLIDER_FRICTION,
  MIN_BOX_SIZE,
  MIN_CAPSULE_RADIUS
}
// Mesh Collider 꼭짓점 한도 칸의 하한 [결정: spec-5 §1.2 Vertex Limit 8–64]
export const MIN_VERTEX_LIMIT = 8
// 64(src/shared/sim/hull.ts)
export const MAX_VERTEX_LIMIT = MAX_HULL_POINTS
// 32(Box3D boulder, hull.ts)
export const DEFAULT_VERTEX_LIMIT = HULL_DEFAULT_VERTEX_LIMIT
// 사용자 Mesh Collider 껍질 오차가 이보다 크면 인스펙터가 경고한다(m) [조사 결정 M§3 6, F7: 자동 껍질은 경고하지 않음]
export const HULL_ERROR_WARN = 2e-3
// 몸체 17개(섀시 + 관절 16)의 짝 수 17·16/2
export const MAX_FORCE_COLLIDE = 136

// 추가할 때 경계가 없으면 쓰는 크기(m) [결정: spec-5 §1.2]
const FALLBACK_BOX_SIZE = 0.1
const FALLBACK_CAPSULE_RADIUS = 0.05
const FALLBACK_CAPSULE_HEIGHT = 0.2

// Unity는 어느 GameObject에나 Collider를 붙인다: 모든 kind(robot·CAD 루트·group·assembly·part)
export function canHaveColliders(object: SceneObject): boolean {
  return (
    object.kind === 'robot' ||
    object.kind === 'group' ||
    object.kind === 'assembly' ||
    object.kind === 'part'
  )
}

export function canHaveRobotCollision(object: SceneObject): boolean {
  return object.kind === 'robot'
}

// 스토어가 받는 값의 형식(spec-5 §2.1 "형식 검사는 스토어·파일이 먼저 한다"): id가 1–64자 글자이고(프로젝트 파일 규칙과 같다),
// 종류·방향이 아는 값이고, 칸의 수가 모두 유한하다. 유한하지 않은 수는 자르기(sanitizeCollider)를 그대로 지나 문서에 남고, JSON에서
// null이 되어 저장한 프로젝트를 다시 열지 못하게 한다. friction은 범위 밖(유한하지 않은 수 포함)이면 정리가 키를 지우므로 보지 않는다
const finiteVec = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x))
export function isWellFormedCollider(c: ColliderSettings): boolean {
  if (typeof c.id !== 'string' || c.id.length < 1 || c.id.length > 64) return false
  switch (c.kind) {
    case 'box':
      return finiteVec(c.center) && finiteVec(c.size)
    case 'capsule':
      return (
        finiteVec(c.center) &&
        Number.isFinite(c.radius) &&
        Number.isFinite(c.height) &&
        COLLIDER_DIRECTIONS.includes(c.direction)
      )
    case 'mesh':
      return Number.isFinite(c.vertexLimit)
    default:
      return false
  }
}

// [min, max]로 자르고 −0을 0으로
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value)) + 0
const clampVec = (v: Vec3T, min: number, max: number): Vec3T => [
  clamp(v[0], min, max),
  clamp(v[1], min, max),
  clamp(v[2], min, max)
]

// 공통 칸: enabled는 false일 때만, friction은 범위 안일 때만(밖이면 키를 지워 기본값). 키 순서는 id, kind, enabled?, 종류 칸,
// friction(직렬화·실행 취소 비교가 바이트로 안정하다)
function withTail<T extends ColliderSettings>(c: ColliderSettings, shape: T): T {
  const out: T = { ...shape }
  if (Number.isFinite(c.friction) && c.friction! >= 0 && c.friction! <= MAX_COLLIDER_FRICTION)
    out.friction = c.friction! + 0
  return out
}

// 범위를 자른 새 값(유한 수가 아닌 값은 들어오지 않는다: 형식 검사는 스토어·파일이 먼저 한다). 길이를 기본값으로 바꾸지 않고
// 자르는 것은 Box 기본 크기가 형상에서 오므로 고정 기본값이 없기 때문이다 [결정, spec-5 §2.1]
export function sanitizeCollider(c: ColliderSettings): ColliderSettings {
  const head =
    c.enabled === false
      ? { id: c.id, kind: c.kind, enabled: false as const }
      : { id: c.id, kind: c.kind }
  switch (c.kind) {
    case 'box':
      return withTail(c, {
        ...head,
        kind: 'box',
        center: clampVec(c.center, -MAX_COLLIDER_EXTENT, MAX_COLLIDER_EXTENT),
        size: clampVec(c.size, MIN_BOX_SIZE, MAX_COLLIDER_EXTENT)
      })
    case 'capsule':
      return withTail(c, {
        ...head,
        kind: 'capsule',
        center: clampVec(c.center, -MAX_COLLIDER_EXTENT, MAX_COLLIDER_EXTENT),
        radius: clamp(c.radius, MIN_CAPSULE_RADIUS, MAX_CAPSULE_RADIUS),
        height: clamp(c.height, 0, 2 * MAX_COLLIDER_EXTENT),
        direction: c.direction
      })
    case 'mesh':
      return withTail(c, {
        ...head,
        kind: 'mesh',
        vertexLimit: clamp(Math.round(c.vertexLimit), MIN_VERTEX_LIMIT, MAX_VERTEX_LIMIT)
      })
  }
}

// 같은 id는 앞의 것만, 그 뒤 앞 MAX_OBJECT_COLLIDERS개
export function sanitizeColliders(list: readonly ColliderSettings[]): ColliderSettings[] {
  const seen = new Set<string>()
  const out: ColliderSettings[] = []
  for (const c of list) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(sanitizeCollider(c))
  }
  return out.slice(0, MAX_OBJECT_COLLIDERS)
}

const sameVec = (a: Vec3T, b: Vec3T): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

function sameCollider(a: ColliderSettings, b: ColliderSettings): boolean {
  if (
    a.id !== b.id ||
    a.kind !== b.kind ||
    colliderEnabled(a) !== colliderEnabled(b) ||
    a.friction !== b.friction
  )
    return false
  switch (a.kind) {
    case 'box':
      return b.kind === 'box' && sameVec(a.center, b.center) && sameVec(a.size, b.size)
    case 'capsule':
      return (
        b.kind === 'capsule' &&
        sameVec(a.center, b.center) &&
        a.radius === b.radius &&
        a.height === b.height &&
        a.direction === b.direction
      )
    case 'mesh':
      return b.kind === 'mesh' && a.vertexLimit === b.vertexLimit
  }
}

// 값 비교(없음 = [])
export function sameColliders(
  a: readonly ColliderSettings[] | undefined,
  b: readonly ColliderSettings[] | undefined
): boolean {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((c, i) => sameCollider(c, y[i]))
}

// 사전순 짝(문자열 코드 단위 순서, 결정적)
export function forceCollideKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

// 짝마다 사전순으로 놓고 같은 짝·같은 id 둘(a = b)을 빼고 목록을 사전순으로, 앞 MAX_FORCE_COLLIDE개. 비면 null
export function sanitizeRobotCollision(s: RobotCollisionSettings): RobotCollisionSettings | null {
  const pairs = new Map<string, [string, string]>()
  for (const [a, b] of s.forceCollide) {
    if (a === b) continue
    const pair = forceCollideKey(a, b)
    pairs.set(JSON.stringify(pair), pair)
  }
  const sorted = [...pairs.values()].sort((x, y) =>
    x[0] !== y[0] ? (x[0] < y[0] ? -1 : 1) : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0
  )
  return sorted.length > 0 ? { forceCollide: sorted.slice(0, MAX_FORCE_COLLIDE) } : null
}

export function sameRobotCollision(
  a: RobotCollisionSettings | undefined,
  b: RobotCollisionSettings | undefined
): boolean {
  const x = a?.forceCollide ?? []
  const y = b?.forceCollide ?? []
  return x.length === y.length && x.every((pair, i) => pair[0] === y[i][0] && pair[1] === y[i][1])
}

// 오브젝트 틀의 하위 경계 상자(spec-5 §1.2: 같은 몸체 메시마다 형상 boundingBox 8꼭짓점을 오브젝트 틀로 옮겨 합친 축 정렬
// 경계). 형상이 하나도 없으면 null
export type ColliderBounds = { min: Vec3T; max: Vec3T } | null

const boundsCenter = (b: NonNullable<ColliderBounds>): Vec3T => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2
]
const boundsSize = (b: NonNullable<ColliderBounds>): Vec3T => [
  b.max[0] - b.min[0],
  b.max[1] - b.min[1],
  b.max[2] - b.min[2]
]

// Box: Center = 하위 경계 상자 중심, Size = 그 크기(Unity BoxColliderFitUtility, 렌더러 경계 합). 없으면 Center 0, 0.1 m 정육면체
export function defaultBox(id: string, bounds: ColliderBounds): BoxColliderSettings {
  const box: BoxColliderSettings = bounds
    ? { id, kind: 'box', center: boundsCenter(bounds), size: boundsSize(bounds) }
    : {
        id,
        kind: 'box',
        center: [0, 0, 0],
        size: [FALLBACK_BOX_SIZE, FALLBACK_BOX_SIZE, FALLBACK_BOX_SIZE]
      }
  return sanitizeCollider(box) as BoxColliderSettings
}

// Capsule: Direction = 하위 경계 상자의 가장 긴 축(같으면 x → y → z), Height = 그 길이, Radius = 나머지 두 길이 중 큰 것의 절반,
// Center = 중심. 없으면 Radius 0.05, Height 0.2, Direction = upAxis(오브젝트 로컬 축 가운데 로봇 +Z와 가장 나란한 축, F13)
export function defaultCapsule(
  id: string,
  bounds: ColliderBounds,
  upAxis: ColliderDirection
): CapsuleColliderSettings {
  let capsule: CapsuleColliderSettings
  if (bounds) {
    const size = boundsSize(bounds)
    let axis = 0
    for (let k = 1; k < 3; k++) if (size[k] > size[axis]) axis = k
    const others = [0, 1, 2].filter((k) => k !== axis).map((k) => size[k])
    capsule = {
      id,
      kind: 'capsule',
      center: boundsCenter(bounds),
      radius: Math.max(...others) / 2,
      height: size[axis],
      direction: COLLIDER_DIRECTIONS[axis]
    }
  } else
    capsule = {
      id,
      kind: 'capsule',
      center: [0, 0, 0],
      radius: FALLBACK_CAPSULE_RADIUS,
      height: FALLBACK_CAPSULE_HEIGHT,
      direction: upAxis
    }
  return sanitizeCollider(capsule) as CapsuleColliderSettings
}

// Mesh: Vertex Limit 32, 마찰 빈 칸
export function defaultMesh(id: string): MeshColliderSettings {
  return { id, kind: 'mesh', vertexLimit: DEFAULT_VERTEX_LIMIT }
}

export function colliderFriction(c: ColliderSettings): number {
  return c.friction ?? DEFAULT_COLLIDER_FRICTION
}

export function colliderEnabled(c: ColliderSettings): boolean {
  return c.enabled !== false
}
