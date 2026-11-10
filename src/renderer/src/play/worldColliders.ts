import { Matrix4, Vector3 } from 'three'
import {
  EDIT_OVERLAP_TOLERANCE,
  editPoseOverlaps,
  type EditPoseBody
} from '../../../shared/sim/collision3d'
import {
  buildHull,
  canonicalHull,
  HULL_DEFAULT_VERTEX_LIMIT,
  type Hull
} from '../../../shared/sim/hull'
import type { Frame3 } from '../../../shared/sim/sensorFrame'
import {
  DEFAULT_COLLIDER_FRICTION,
  MAX_BODY_COLLIDERS,
  MAX_WORLD_COLLIDERS,
  type SimCollider,
  type Vec2,
  type Vec3
} from '../../../shared/sim/worldSpec'
import {
  colliderEnabled,
  colliderFriction,
  forceCollideKey,
  type ColliderDirection,
  type ColliderSettings
} from '../scene/collider'
import type { ColliderShapeLookup, ObjectHullPoints } from '../scene/meshHull'
import { childrenInDocument, subtreeIds, type SceneObject, type SceneObjects } from '../scene/model'
import { robotMeshes, robotObjectMatrix } from '../scene/robotMeshIndex'
import { plain } from './plain'
import type { JointBodyFrames } from './worldJoints'
import type { WorldWarning } from './worldSpec'

// 몸체마다 충돌 형상을 정한다(spec-5 §5.4, 순수 함수): 그 몸체 소속 오브젝트의 Collider(끈 것도 "있음"으로 셈), 없으면 몸체 메시의
// 자동 볼록 껍질, 섀시는 그것도 없으면 외곽 대체 상자. 편집 자세에서 겹친 자기 몸체 짝은 앞 계산(editPoseOverlaps)으로 무시 목록에
// 넣고, 로봇의 [그래도 충돌] 짝은 뺀다.
//
// 몸체는 jointBodyFrames(play/worldJoints.ts)를 따른다: 섀시(−1)는 로봇 하위에서 관절 몸체를 뺀 것, 관절 몸체 i는 세계 설명 관절 i의
// 오브젝트와 그 하위(안쪽 관절 하위 빼고). 몸체 틀은 섀시 = 로봇 좌표, 관절 몸체 = 관절 틀(frames[i], q = 0)이다. 오브젝트 → 몸체 틀
// 행렬은 로봇 좌표 표(scene/robotMeshIndex.ts, 부모 사슬을 한 번만 곱함)에 관절 틀의 역을 곱한 것이다. 메시 점은 STEP 워커가 만든
// 메시 껍질(shapes, scene/meshHull.ts)이라 여기서 메시 꼭짓점을 훑지 않는다. 몸체·Mesh Collider의 껍질은 V = buildHull(모은 점,
// 한도).vertices이고 세계 설명에 V를 보낸다(메인이 canonicalHull(V)로 다시 만든다, §1.11). 표시·개수·오차는 canonicalHull(V)다.
//
// 기억(cache, editor/collider/useCollisionModel.ts): 몸체 결과는 몸체 소속 오브젝트의 형상 칸(부모·transform·모양·Collider)과 메시
// 껍질 조회 결과, 관절 틀의 참조·값이 같으면 다시 쓴다(문서는 불변이고 바뀌지 않은 칸은 참조가 같다). 이름 바꾸기·하드웨어
// 속성 같은 충돌 무관 편집은 다시 계산하지 않는다. 앞 계산은 두 몸체 결과가 같은 짝을 다시 하지 않는다.

// colliders: 켠 Collider에서 나옴, disabled: Collider가 있으나 모두 꺼짐(충돌 없음), auto: 자동 볼록 껍질, fallback: 섀시 외곽 대체
// 상자(메시를 읽지 못함), none: 형상 없음(관절 몸체에 메시가 없음)
export type BodyShapeSource = 'colliders' | 'disabled' | 'auto' | 'fallback' | 'none'

export type WorldColliderEntry = {
  // 충돌체를 붙인 오브젝트(자동·대체는 몸체 오브젝트)
  objectId: string
  // Collider id(자동·대체는 null)
  colliderId: string | null
  // 몸체 틀
  collider: SimCollider
  // convex의 정규 껍질 꼭짓점 수(box·capsule null)
  hullPoints: number | null
  // 껍질 오차(m, 약, 상자·캡슐 0)
  error: number
  // convex의 정규 껍질(canonicalHull(V), 몸체 틀, 기즈모 윤곽). box·capsule은 null
  hull: Hull | null
}

// 몸체 소속 Collider 하나의 상태(인스펙터 카드 결과 줄·씬 뷰 기즈모). 끈 Collider도 기즈모가 흐리게 그리도록 형상을 만든다(세계
// 설명에는 넣지 않는다)
export type ColliderState = {
  objectId: string
  colliderId: string
  enabled: boolean
  // ok: 형상이 나옴, pending: 메시를 읽는 중이라 형상 없음, none: 이 몸체의 메시가 없음, degenerate: 껍질이 평평하거나 얇음
  status: 'ok' | 'pending' | 'none' | 'degenerate'
  // ok일 때 형상(몸체 틀)
  entry: WorldColliderEntry | null
  // Mesh Collider가 모은 메시 가운데 읽는 중·못 읽은 수(Box·Capsule은 0)
  pendingMeshes: number
  // 켠 Collider인데 한도(몸체 MAX_BODY_COLLIDERS·세계 MAX_WORLD_COLLIDERS)로 세계 설명에서 뺐음
  capped: boolean
}

export type WorldColliderBody = {
  // −1 섀시, ≥ 0 kept 관절 순번
  body: number
  // 섀시 = 로봇 id, 관절 = 관절 오브젝트 id
  objectId: string
  // 표시 이름(같은 이름이 둘 이상이면 부모 이름을 괄호로, 그래도 같으면 "#<body + 2>")
  name: string
  // 관절 몸체의 부모 몸체(섀시는 null)
  parent: number | null
  source: BodyShapeSource
  // 세계 설명에 넣는 충돌체(몸체 틀, 한도 뒤)
  colliders: WorldColliderEntry[]
  // 형상을 읽는 중이거나 못 읽은 그 몸체의 메시 수(형상에 들어갈 메시만: 자동·대체는 몸체 전체, Collider는 켠 Mesh Collider가 모은 것)
  pendingMeshes: number
  // 평평하거나 얇아 뺀 Mesh Collider·자동 껍질 수
  degenerate: number
  // 관절 몸체의 편집 자세 바닥 간격(min z, m, F10), 섀시 null
  floorGap: number | null
  // 몸체 소속 Collider(소속 오브젝트 문서 순서, 그 안에서 배열 순서, 끈 것 포함)
  states: ColliderState[]
}

// 편집 자세에서 겹쳐 무시하는 몸체 짝(a < b, 몸체 번호)과 그 몸체 오브젝트, 겹침 깊이(m), 로봇의 [그래도 충돌]에 있는지
export type IgnoredPair = {
  a: number
  b: number
  aObjectId: string
  bObjectId: string
  depth: number
  forced: boolean
}

export type CollisionModel = {
  bodies: WorldColliderBody[]
  pairs: IgnoredPair[]
  // 지금 무시 목록에 없는 forceCollide 짝 수(끊긴 id 짝은 빼고 셈, F16)
  staleForced: number
  warnings: WorldWarning[]
}

// ---- 기억 ----

type BodyCore = {
  source: BodyShapeSource
  // 몸체 한도(MAX_BODY_COLLIDERS) 앞의 켠 충돌체(대체·자동 포함)
  entries: WorldColliderEntry[]
  // 몸체 한도로 뺀 것이 있음
  bodyCapped: boolean
  states: ColliderState[]
  pendingMeshes: number
  degenerate: number
}

type BodyCacheEntry = {
  key: unknown[]
  core: BodyCore
  // 마지막에 내준 몸체(이름·번호·부모·세계 한도 뒤 충돌체가 같으면 같은 객체를 다시 쓴다)
  assembled: WorldColliderBody | null
}

type PairCacheEntry = {
  a: BodyCore
  b: BodyCore
  frameA: Frame3
  frameB: Frame3
  depth: number | null
}

export type CollisionModelCache = {
  bodies: Map<string, BodyCacheEntry>
  pairs: Map<string, PairCacheEntry>
}

export function createCollisionModelCache(): CollisionModelCache {
  return { bodies: new Map(), pairs: new Map() }
}

// ---- 형상 ----

const AXES: Record<ColliderDirection, [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1]
}

const vec3 = (v: Vector3): Vec3 => ({ x: plain(v.x), y: plain(v.y), z: plain(v.z) })

// 4×4(열 우선)의 회전 3×3을 행 우선 9개로
function rotationRows(matrix: Matrix4): number[] {
  const e = matrix.elements
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].map(plain)
}

function frameOf(matrix: Matrix4): Frame3 {
  const e = matrix.elements
  return {
    rotation: rotationRows(matrix),
    origin: { x: plain(e[12]), y: plain(e[13]), z: plain(e[14]) }
  }
}

const IDENTITY_FRAME: Frame3 = {
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  origin: { x: 0, y: 0, z: 0 }
}

// 점 p(오브젝트 로컬)를 행렬로 옮겨 수 배열 끝에 붙인다(xyz)
function pushPoint(out: number[], e: ArrayLike<number>, p: Vec3): void {
  out.push(
    e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12],
    e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13],
    e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14]
  )
}

// 모은 점(몸체 틀, xyz 수 배열)의 볼록 껍질: V = buildHull(점, 한도).vertices(세계 설명에 보냄)와 정규 껍질 H = canonicalHull(V)
// (표시·개수·오차, 메인이 같은 V로 같은 H를 만든다). 오차는 max(V의 오차, H의 오차, 메시 껍질 오차 최대)(§3.1 오차의 뜻: 하한의 추정)
function convexEntry(
  points: readonly number[],
  limit: number,
  meshError: number,
  objectId: string,
  colliderId: string | null,
  friction: number
): WorldColliderEntry | null {
  const built = buildHull(points, limit)
  if (!built) return null
  const vertices = built.vertices.map((v) => ({ x: plain(v.x), y: plain(v.y), z: plain(v.z) }))
  const hull = canonicalHull(vertices)
  if (!hull) return null
  return {
    objectId,
    colliderId,
    collider: { kind: 'convex', points: vertices, friction },
    hullPoints: hull.vertices.length,
    error: Math.max(built.error, hull.error, meshError),
    hull
  }
}

// Box·Capsule Collider → 세계 설명 충돌체(몸체 틀, §5.2). toBody: 오브젝트 로컬 → 몸체 틀(위치·회전만이라 회전은 정규 직교)
function primitiveEntry(
  collider: Extract<ColliderSettings, { kind: 'box' | 'capsule' }>,
  objectId: string,
  toBody: Matrix4
): WorldColliderEntry {
  const friction = colliderFriction(collider)
  const at = (p: [number, number, number]): Vec3 =>
    vec3(new Vector3(p[0], p[1], p[2]).applyMatrix4(toBody))
  if (collider.kind === 'box') {
    const [sx, sy, sz] = collider.size
    return {
      objectId,
      colliderId: collider.id,
      collider: {
        kind: 'box',
        center: at(collider.center),
        rotation: rotationRows(toBody),
        half: { x: plain(sx / 2), y: plain(sy / 2), z: plain(sz / 2) },
        friction
      },
      hullPoints: null,
      error: 0,
      hull: null
    }
  }
  const [ex, ey, ez] = AXES[collider.direction]
  const half = Math.max(0, collider.height / 2 - collider.radius)
  const [cx, cy, cz] = collider.center
  return {
    objectId,
    colliderId: collider.id,
    collider: {
      kind: 'capsule',
      a: at([cx - half * ex, cy - half * ey, cz - half * ez]),
      b: at([cx + half * ex, cy + half * ey, cz + half * ez]),
      radius: collider.radius,
      friction
    },
    hullPoints: null,
    error: 0,
    hull: null
  }
}

// ---- 몸체 ----

type BodyInput = {
  body: number
  objectId: string
  // 몸체 소속 오브젝트(문서 순서, 몸체 오브젝트가 처음)
  members: string[]
  memberSet: ReadonlySet<string>
  // 로봇 좌표 → 몸체 틀(섀시는 null = 단위)
  fromRobot: Matrix4 | null
  // 관절 틀(로봇 좌표, 섀시는 단위)
  frame: Matrix4 | null
}

type MeshRef = { id: string; toRobot: Matrix4 }

// 몸체 소속 모양 오브젝트에서 점을 모은다(몸체 틀). 점이 있으면 points에, 상태를 센다
function gatherPoints(
  meshes: readonly MeshRef[],
  shapes: ColliderShapeLookup,
  fromRobot: Matrix4 | null
): { points: number[]; pending: string[]; degenerate: number; meshes: number; error: number } {
  const points: number[] = []
  const pending: string[] = []
  let degenerate = 0
  let error = 0
  const toBody = new Matrix4()
  for (const mesh of meshes) {
    const shape: ObjectHullPoints = shapes(mesh.id)
    if (shape.kind === 'pending') pending.push(mesh.id)
    else if (shape.kind === 'degenerate') degenerate++
    else if (shape.kind === 'points') {
      if (fromRobot) toBody.multiplyMatrices(fromRobot, mesh.toRobot)
      const e = fromRobot ? toBody.elements : mesh.toRobot.elements
      for (const p of shape.points) pushPoint(points, e, p)
      if (shape.error > error) error = shape.error
    }
  }
  return { points, pending, degenerate, meshes: meshes.length, error }
}

function computeBody(
  objects: SceneObjects,
  robotId: string,
  input: BodyInput,
  meshes: readonly MeshRef[],
  shapes: ColliderShapeLookup,
  outline: { footprint: Vec2[]; height: number }
): BodyCore {
  const { objectId: bodyObjectId, members, memberSet, fromRobot } = input
  const chassis = input.body < 0
  const meshOf = new Map(meshes.map((mesh) => [mesh.id, mesh]))
  const toBodyOf = (id: string): Matrix4 | null => {
    const robot = meshOf.get(id)?.toRobot ?? robotObjectMatrix(objects, robotId, id)
    if (!robot) return null
    return fromRobot ? fromRobot.clone().multiply(robot) : robot.clone()
  }
  // 오브젝트 하위(자신 포함) 가운데 같은 몸체의 모양 오브젝트(문서 순서)
  const meshesUnder = (id: string): MeshRef[] => {
    const out: MeshRef[] = []
    const walk = (current: string): void => {
      const mesh = meshOf.get(current)
      if (mesh) out.push(mesh)
      for (const child of childrenInDocument(objects, current))
        if (memberSet.has(child.id)) walk(child.id)
    }
    walk(id)
    return out
  }

  const states: ColliderState[] = []
  const entries: WorldColliderEntry[] = []
  const pendingIds = new Set<string>()
  let degenerate = 0
  let hasColliders = false
  let enabledCount = 0
  for (const id of members) {
    for (const collider of objects[id].colliders ?? []) {
      hasColliders = true
      const enabled = colliderEnabled(collider)
      if (enabled) enabledCount++
      const state: ColliderState = {
        objectId: id,
        colliderId: collider.id,
        enabled,
        status: 'ok',
        entry: null,
        pendingMeshes: 0,
        capped: false
      }
      if (collider.kind === 'mesh') {
        const gathered = gatherPoints(meshesUnder(id), shapes, fromRobot)
        state.pendingMeshes = gathered.pending.length
        if (enabled) for (const mesh of gathered.pending) pendingIds.add(mesh)
        const entry =
          gathered.points.length > 0
            ? convexEntry(
                gathered.points,
                collider.vertexLimit,
                gathered.error,
                id,
                collider.id,
                colliderFriction(collider)
              )
            : null
        // 점이 있는데 껍질이 없으면 퇴화, 점이 없으면 읽는 중이 먼저다(다 읽으면 점이 생길 수 있다)
        if (entry) state.entry = entry
        else if (gathered.points.length > 0) state.status = 'degenerate'
        else if (gathered.pending.length > 0) state.status = 'pending'
        else if (gathered.degenerate > 0) state.status = 'degenerate'
        else state.status = 'none'
        if (enabled && state.status === 'degenerate') degenerate++
      } else {
        const toBody = toBodyOf(id)
        if (toBody) state.entry = primitiveEntry(collider, id, toBody)
        else state.status = 'none'
      }
      if (enabled && state.entry) entries.push(state.entry)
      states.push(state)
    }
  }

  let source: BodyShapeSource
  let used = entries
  let pendingMeshes = pendingIds.size
  if (hasColliders && enabledCount === 0) {
    source = 'disabled'
    pendingMeshes = 0
  } else if (hasColliders && entries.length > 0) source = 'colliders'
  else {
    // 자동 볼록 껍질: Collider가 없거나, 켠 Collider가 모두 빠진 섀시(대체 상자를 쓰기 전에, 빠진 이유는 그 Collider 상태가 말한다)
    let auto: WorldColliderEntry | null = null
    if (!hasColliders) {
      const gathered = gatherPoints(meshes, shapes, fromRobot)
      pendingMeshes = gathered.pending.length
      if (gathered.points.length > 0) {
        auto = convexEntry(
          gathered.points,
          HULL_DEFAULT_VERTEX_LIMIT,
          gathered.error,
          bodyObjectId,
          null,
          DEFAULT_COLLIDER_FRICTION
        )
        if (!auto) degenerate++
      } else if (gathered.degenerate > 0 && gathered.pending.length === 0) degenerate++
    }
    if (auto) {
      source = 'auto'
      used = [auto]
    } else if (chassis) {
      source = 'fallback'
      used = [fallbackBox(outline, bodyObjectId)]
    } else {
      source = 'none'
      used = []
    }
  }
  const bodyCapped = used.length > MAX_BODY_COLLIDERS
  if (bodyCapped) {
    const kept = new Set(used.slice(0, MAX_BODY_COLLIDERS))
    for (const state of states)
      if (state.entry && state.enabled && !kept.has(state.entry)) state.capped = true
    used = used.slice(0, MAX_BODY_COLLIDERS)
  }
  return { source, entries: used, bodyCapped, states, pendingMeshes, degenerate }
}

// 섀시 대체 상자: 외곽 사각형의 경계 × [0, 높이](4ab 평면 프리즘과 같은 크기, 단위 회전, 기본 마찰)
function fallbackBox(
  outline: { footprint: Vec2[]; height: number },
  objectId: string
): WorldColliderEntry {
  const xs = outline.footprint.map((p) => p.x)
  const ys = outline.footprint.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    objectId,
    colliderId: null,
    collider: {
      kind: 'box',
      center: {
        x: plain((minX + maxX) / 2),
        y: plain((minY + maxY) / 2),
        z: plain(outline.height / 2)
      },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      half: {
        x: plain((maxX - minX) / 2),
        y: plain((maxY - minY) / 2),
        z: plain(outline.height / 2)
      },
      friction: DEFAULT_COLLIDER_FRICTION
    },
    hullPoints: null,
    error: 0,
    hull: null
  }
}

// 몸체 기억 열쇠: 소속 오브젝트마다 형상 칸(부모·transform·모양·Collider 참조)과 메시 껍질 조회 결과, 관절 몸체는 관절 설정 참조와
// 관절 틀 값(로봇 좌표, 바닥 간격·편집 자세 틀이 쓴다). 이름·하드웨어 등 다른 칸은 넣지 않는다
function bodyKey(
  objects: SceneObjects,
  input: BodyInput,
  shapes: ColliderShapeLookup,
  outline: { footprint: Vec2[]; height: number }
): unknown[] {
  const key: unknown[] = [input.body < 0 ? 'chassis' : 'joint']
  for (const id of input.members) {
    const object: SceneObject = objects[id]
    key.push(id, object.parentId, object.colliders, object.visual)
    // 몸체 오브젝트 자신의 자세는 몸체 틀 안의 점을 바꾸지 않는다(관절 틀 값이 대신 들어간다). 섀시 뿌리(로봇)도 마찬가지다
    if (id !== input.objectId) key.push(object.transform)
    else if (input.body >= 0) key.push(object.joint)
    if (object.visual) key.push(shapes(id))
  }
  if (input.frame) key.push(...input.frame.elements)
  // 섀시 대체 상자는 외곽에 기댄다
  if (input.body < 0) key.push(...outline.footprint.flatMap((p) => [p.x, p.y]), outline.height)
  return key
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((value, i) => Object.is(value, b[i]))

// 관절 몸체의 편집 자세 바닥 간격: 로봇 좌표에서 그 몸체 충돌체의 가장 낮은 z(캡슐은 끝점 z − r)
function floorGapOf(entries: readonly WorldColliderEntry[], frame: Matrix4): number | null {
  if (entries.length === 0) return null
  const e = frame.elements
  const z = (p: Vec3): number => e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14]
  let min = Infinity
  for (const { collider } of entries) {
    if (collider.kind === 'convex') for (const p of collider.points) min = Math.min(min, z(p))
    else if (collider.kind === 'capsule')
      min = Math.min(min, z(collider.a) - collider.radius, z(collider.b) - collider.radius)
    else {
      const { center: c, rotation: r, half: h } = collider
      for (let k = 0; k < 8; k++) {
        const lx = k & 1 ? h.x : -h.x
        const ly = k & 2 ? h.y : -h.y
        const lz = k & 4 ? h.z : -h.z
        min = Math.min(
          min,
          z({
            x: c.x + r[0] * lx + r[1] * ly + r[2] * lz,
            y: c.y + r[3] * lx + r[4] * ly + r[5] * lz,
            z: c.z + r[6] * lx + r[7] * ly + r[8] * lz
          })
        )
      }
    }
  }
  return Number.isFinite(min) ? plain(min) : null
}

// 같은 이름 몸체 나누기(§5.4 6): 부모 오브젝트 이름을 괄호로, 그래도 같으면 "#<body + 2>"(섀시 #1)
function bodyNames(objects: SceneObjects, inputs: readonly BodyInput[]): string[] {
  const count = (labels: readonly string[], label: string): number =>
    labels.filter((other) => other === label).length
  const base = inputs.map((input) => objects[input.objectId].name)
  const withParent = inputs.map((input, i) => {
    if (count(base, base[i]) < 2) return base[i]
    const parentId = objects[input.objectId].parentId
    const parent = parentId !== null ? objects[parentId] : undefined
    return parent ? `${base[i]} (${parent.name})` : base[i]
  })
  return inputs.map((input, i) =>
    count(withParent, withParent[i]) < 2 ? withParent[i] : `${withParent[i]} #${input.body + 2}`
  )
}

// ---- 모델 ----

export function buildCollisionModel(input: {
  objects: SceneObjects
  robotId: string
  joints: JointBodyFrames
  shapes: ColliderShapeLookup
  // robotOutline(play/worldSpec.ts)
  outline: { footprint: Vec2[]; height: number }
  // 시험이 가짜를 넘긴다, 기본은 shared 함수
  overlaps?: typeof editPoseOverlaps
  // 몸체·짝 결과 기억(editor/collider/useCollisionModel.ts). 없으면 모두 새로 계산한다(INIT, 결과는 같다)
  cache?: CollisionModelCache
}): CollisionModel {
  const { objects, robotId, joints, shapes, outline, cache } = input
  const overlaps = input.overlaps ?? editPoseOverlaps
  const robot = objects[robotId]
  if (!robot) return { bodies: [], pairs: [], staleForced: 0, warnings: [] }

  // 몸체 소속(문서 순서)
  const memberLists = new Map<number, string[]>([[-1, []]])
  joints.objectIds.forEach((_, i) => memberLists.set(i, []))
  for (const id of subtreeIds(objects, robotId)) {
    const body = joints.bodyOf.get(id) ?? -1
    memberLists.get(body)?.push(id)
  }
  const inputs: BodyInput[] = [-1, ...joints.objectIds.map((_, i) => i)].map((body) => {
    const members = memberLists.get(body)!
    const frame = body < 0 ? null : joints.frames[body]
    return {
      body,
      objectId: body < 0 ? robotId : joints.objectIds[body],
      members,
      memberSet: new Set(members),
      fromRobot: frame ? frame.clone().invert() : null,
      frame
    }
  })

  // 몸체마다 결과(기억이 맞으면 다시 쓴다). 로봇 좌표 표는 다시 계산할 몸체가 있을 때만 만든다
  let meshByBody: Map<number, MeshRef[]> | null = null
  const meshesOf = (body: number): MeshRef[] => {
    if (!meshByBody) {
      meshByBody = new Map()
      for (const entry of robotMeshes(objects, robotId)) {
        const owner = joints.bodyOf.get(entry.id) ?? -1
        const list = meshByBody.get(owner)
        if (list) list.push(entry)
        else meshByBody.set(owner, [entry])
      }
    }
    return meshByBody.get(body) ?? []
  }
  const names = bodyNames(objects, inputs)
  const cores = inputs.map((body): { core: BodyCore; cached: BodyCacheEntry | null } => {
    const key = cache ? bodyKey(objects, body, shapes, outline) : null
    const hit = cache?.bodies.get(body.objectId)
    if (hit && key && sameKey(hit.key, key)) return { core: hit.core, cached: hit }
    const core = computeBody(objects, robotId, body, meshesOf(body.body), shapes, outline)
    if (cache && key) {
      const entry: BodyCacheEntry = { key, core, assembled: null }
      cache.bodies.set(body.objectId, entry)
      return { core, cached: entry }
    }
    return { core, cached: null }
  })
  if (cache) {
    const live = new Set(inputs.map((body) => body.objectId))
    for (const id of [...cache.bodies.keys()]) if (!live.has(id)) cache.bodies.delete(id)
  }

  // 세계 한도(몸체 순서로 앞의 것만)와 경고
  const warnings: WorldWarning[] = []
  let total = 0
  let worldCapped = false
  const bodies = inputs.map((body, i): WorldColliderBody => {
    const { core, cached } = cores[i]
    const room = Math.max(0, MAX_WORLD_COLLIDERS - total)
    const colliders = core.entries.length <= room ? core.entries : core.entries.slice(0, room)
    if (colliders.length < core.entries.length) worldCapped = true
    total += colliders.length
    const name = names[i]
    if (core.pendingMeshes > 0)
      warnings.push({ key: 'worldColliderPending', params: { name, count: core.pendingMeshes } })
    if (core.degenerate > 0)
      warnings.push({ key: 'worldColliderDegenerate', params: { name, count: core.degenerate } })
    if (core.bodyCapped)
      warnings.push({ key: 'worldTooManyColliders', params: { name, max: MAX_BODY_COLLIDERS } })
    const parent = body.body < 0 ? null : joints.parents[body.body]
    const floorGap = body.frame ? floorGapOf(colliders, body.frame) : null
    const previous = cached?.assembled
    if (
      previous &&
      previous.body === body.body &&
      previous.name === name &&
      previous.parent === parent &&
      previous.floorGap === floorGap &&
      previous.colliders.length === colliders.length &&
      previous.colliders.every((entry, k) => entry === colliders[k])
    )
      return previous
    const kept = new Set(colliders)
    const states =
      colliders.length === core.entries.length
        ? core.states
        : core.states.map((state) =>
            state.entry && state.enabled && !kept.has(state.entry)
              ? { ...state, capped: true }
              : state
          )
    const assembled: WorldColliderBody = {
      body: body.body,
      objectId: body.objectId,
      name,
      parent,
      source: core.source,
      colliders,
      pendingMeshes: core.pendingMeshes,
      degenerate: core.degenerate,
      floorGap,
      states
    }
    if (cached) cached.assembled = assembled
    return assembled
  })
  if (worldCapped)
    warnings.push({ key: 'worldTooManyWorldColliders', params: { max: MAX_WORLD_COLLIDERS } })

  // 편집 자세 겹침(§5.4): 바로 붙은 부모–자식이 아닌 몸체 짝마다(형상이 있는 것만) 앞 계산. 기억은 두 몸체 결과·틀이 같은 짝을 다시
  // 쓴다
  const editBodies = inputs.map((body, i): EditPoseBody => ({
    body: body.body,
    parent: body.body < 0 ? -2 : joints.parents[body.body],
    frame: body.frame ? frameOf(body.frame) : IDENTITY_FRAME,
    colliders: bodies[i].colliders.map((entry) => entry.collider)
  }))
  const forced = new Set(
    (robot.collision?.forceCollide ?? []).map(([a, b]) => JSON.stringify(forceCollideKey(a, b)))
  )
  const pairs: IgnoredPair[] = []
  const livePairs = new Set<string>()
  for (let i = 0; i < inputs.length; i++)
    for (let j = i + 1; j < inputs.length; j++) {
      const a = editBodies[i]
      const b = editBodies[j]
      if (a.colliders.length === 0 || b.colliders.length === 0) continue
      if (b.parent === a.body || a.parent === b.body) continue
      const pairKey = `${inputs[i].objectId}|${inputs[j].objectId}`
      livePairs.add(pairKey)
      let depth: number | null
      const hit = cache?.pairs.get(pairKey)
      if (
        hit &&
        hit.a === cores[i].core &&
        hit.b === cores[j].core &&
        sameFrame(hit.frameA, a.frame) &&
        sameFrame(hit.frameB, b.frame) &&
        bodies[i].colliders.length === cores[i].core.entries.length &&
        bodies[j].colliders.length === cores[j].core.entries.length
      )
        depth = hit.depth
      else {
        const found = overlaps([a, b], EDIT_OVERLAP_TOLERANCE).find(
          (overlap) => overlap.a === a.body && overlap.b === b.body
        )
        depth = found ? found.depth : null
        cache?.pairs.set(pairKey, {
          a: cores[i].core,
          b: cores[j].core,
          frameA: a.frame,
          frameB: b.frame,
          depth
        })
      }
      if (depth === null) continue
      const aObjectId = inputs[i].objectId
      const bObjectId = inputs[j].objectId
      pairs.push({
        a: a.body,
        b: b.body,
        aObjectId,
        bObjectId,
        depth,
        forced: forced.has(JSON.stringify(forceCollideKey(aObjectId, bObjectId)))
      })
    }
  if (cache)
    for (const key of [...cache.pairs.keys()]) if (!livePairs.has(key)) cache.pairs.delete(key)

  // 지금 무시 목록에 없는 [그래도 충돌] 짝(둘 다 지금 몸체 오브젝트인 것만 센다. 끊긴 id 짝은 실행 취소로 되살릴 수 있어 남긴다)
  const bodyObjects = new Set(inputs.map((body) => body.objectId))
  const current = new Set(
    pairs.map((pair) => JSON.stringify(forceCollideKey(pair.aObjectId, pair.bObjectId)))
  )
  const staleForced = (robot.collision?.forceCollide ?? []).filter(
    ([a, b]) =>
      bodyObjects.has(a) &&
      bodyObjects.has(b) &&
      !current.has(JSON.stringify(forceCollideKey(a, b)))
  ).length

  return { bodies, pairs, staleForced, warnings }
}

const sameFrame = (a: Frame3, b: Frame3): boolean =>
  a.origin.x === b.origin.x &&
  a.origin.y === b.origin.y &&
  a.origin.z === b.origin.z &&
  a.rotation.every((value, k) => value === b.rotation[k])

// 지금 무시 목록에 없는 [그래도 충돌] 짝(둘 다 지금 몸체 오브젝트인 것). [지우기]가 이것만 뺀다
export function staleForcePairs(
  objects: SceneObjects,
  robotId: string,
  model: CollisionModel
): [string, string][] {
  const bodyObjects = new Set(model.bodies.map((body) => body.objectId))
  const current = new Set(
    model.pairs.map((pair) => JSON.stringify(forceCollideKey(pair.aObjectId, pair.bObjectId)))
  )
  return (objects[robotId]?.collision?.forceCollide ?? []).filter(
    ([a, b]) =>
      bodyObjects.has(a) &&
      bodyObjects.has(b) &&
      !current.has(JSON.stringify(forceCollideKey(a, b)))
  )
}
