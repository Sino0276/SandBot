import { Matrix4 } from 'three'
import { boxHull, canonicalHull, type Hull } from '../../../../shared/sim/hull'
import type { SimCollider, Vec3 } from '../../../../shared/sim/worldSpec'
import type { PlayData, PlayRun } from '../../play/playStore'
import type { CollisionModel, WorldColliderEntry } from '../../play/worldColliders'
import type { JointBodyFrames } from '../../play/worldJoints'
import { sanitizeJoint } from '../../scene/joint'
import {
  ancestorIds,
  findRobotId,
  subtreeIds,
  worldMatrix,
  type RootOverride,
  type SceneObjects
} from '../../scene/model'
import { runLocksField } from '../field/fieldDisplay'
import type { JointPreviewState } from '../joint/jointPreviewStore'
import { sensorDisplayOverride } from '../scene/sensorGizmoModel'
import { isHiddenInScene } from '../sceneVisibility'

type VisibilityState = Parameters<typeof isHiddenInScene>[0]

// 씬 뷰 Collider 기즈모(spec-5 §7)의 순수 모델. Unity가 고른 GameObject의 Collider를 초록 윤곽으로 그리듯, 고른 오브젝트들의 몸체
// (그 하위의 관절 몸체 포함, 로봇을 고르면 그 로봇의 모든 몸체)의 충돌 형상(Collider·자동 볼록 껍질·섀시 대체 상자)을 그린다.
// 볼록은 정규 껍질(canonicalHull(V))의 모서리(합친 면이라 대각선이 없다, 메인이 만드는 껍질과 같다), 상자는 boxHull의 모서리 12,
// 캡슐은 Unity 캡슐 기즈모(끝 원 둘, 옆선 넷, 두 축의 반원 넷), 구는 큰 원 셋이다. 선분은 몸체 틀이고 그리는 쪽이 몸체의 표시
// 행렬로 옮긴다(자세가 바뀌어도 선분 배열은 그대로라 형상을 다시 만들지 않는다).

// 원·반원 분할 수(Unity 캡슐 기즈모처럼 매끈하게 보이는 수) [가정: 표시만]
export const CAPSULE_SEGMENTS = 32

// 선분 하나의 모양: normal(켠 Collider·자동 껍질), active(지금 활성 오브젝트의 Collider, 불투명도 1), disabled(끈 Collider, Unity
// 끈 색), fallback(섀시 외곽 대체 상자, 점선)
export type ColliderGizmoStyle = 'normal' | 'active' | 'disabled' | 'fallback'

export type ColliderGizmoItem = {
  // React key(오브젝트·Collider id 또는 자동·대체·실행 순번)
  key: string
  style: ColliderGizmoStyle
  // 몸체 틀 선분(xyz 두 점씩 이어 붙임). 같은 충돌체면 같은 배열이다
  segments: readonly number[]
}

export type ColliderGizmoBody = {
  key: string
  robotId: string
  body: number
  // 몸체 틀 → 필드 좌표 표시 행렬
  matrix: Matrix4
  items: ColliderGizmoItem[]
}

// ---- 선분 ----

const segmentCache = new WeakMap<object, readonly number[]>()

function hullSegments(hull: Hull): number[] {
  const out: number[] = []
  for (const edge of hull.edges) {
    const a = hull.vertices[edge.a]
    const b = hull.vertices[edge.b]
    out.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  return out
}

type V = [number, number, number]
const sub = (a: Vec3, b: Vec3): V => [a.x - b.x, a.y - b.y, a.z - b.z]
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const norm = (a: V): V => {
  const length = Math.hypot(a[0], a[1], a[2])
  return [a[0] / length, a[1] / length, a[2] / length]
}

// 점 c를 중심으로 축 u·v 평면에서 반지름 r, 각 [from, to]의 호(n 분할)
function arc(
  out: number[],
  c: Vec3,
  u: V,
  v: V,
  r: number,
  from: number,
  to: number,
  n: number
): void {
  let prev: V | null = null
  for (let k = 0; k <= n; k++) {
    const angle = from + ((to - from) * k) / n
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const p: V = [
      c.x + r * (cos * u[0] + sin * v[0]),
      c.y + r * (cos * u[1] + sin * v[1]),
      c.z + r * (cos * u[2] + sin * v[2])
    ]
    if (prev) out.push(...prev, ...p)
    prev = p
  }
}

// Unity 캡슐 기즈모: 끝 원 둘, 옆선 넷, 두 축의 반원 넷(각 32분할). 선분이 점이면(구) 큰 원 셋
export function capsuleSegments(a: Vec3, b: Vec3, r: number): number[] {
  const out: number[] = []
  const d = sub(b, a)
  const length = Math.hypot(d[0], d[1], d[2])
  const n = CAPSULE_SEGMENTS
  if (!(length > 1e-9)) {
    arc(out, a, [1, 0, 0], [0, 1, 0], r, 0, 2 * Math.PI, n)
    arc(out, a, [0, 1, 0], [0, 0, 1], r, 0, 2 * Math.PI, n)
    arc(out, a, [0, 0, 1], [1, 0, 0], r, 0, 2 * Math.PI, n)
    return out
  }
  const u = norm(d)
  // u와 가장 덜 나란한 필드 축으로 수직 기저(같으면 x → y → z)
  const abs = [Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])]
  let k = 0
  for (let i = 1; i < 3; i++) if (abs[i] < abs[k]) k = i
  const e: V = [0, 0, 0]
  e[k] = 1
  const v = norm(cross(u, e))
  const w = cross(u, v)
  arc(out, a, v, w, r, 0, 2 * Math.PI, n)
  arc(out, b, v, w, r, 0, 2 * Math.PI, n)
  for (const side of [v, w, [-v[0], -v[1], -v[2]] as V, [-w[0], -w[1], -w[2]] as V])
    out.push(
      a.x + r * side[0],
      a.y + r * side[1],
      a.z + r * side[2],
      b.x + r * side[0],
      b.y + r * side[1],
      b.z + r * side[2]
    )
  const minus: V = [-u[0], -u[1], -u[2]]
  // 끝 반원: 끝점에서 바깥(b는 +u, a는 −u)으로 부푼 반원을 v·w 두 평면에
  arc(out, b, v, u, r, 0, Math.PI, n)
  arc(out, b, w, u, r, 0, Math.PI, n)
  arc(out, a, v, minus, r, 0, Math.PI, n)
  arc(out, a, w, minus, r, 0, Math.PI, n)
  return out
}

// 원기둥 기즈모(6a, Unity에 없음): 뚜껑 원 둘과 옆선 넷(각 32분할). 기저는 캡슐과 같은 규칙
export function cylinderSegments(a: Vec3, b: Vec3, r: number): number[] {
  const out: number[] = []
  const d = sub(b, a)
  const length = Math.hypot(d[0], d[1], d[2])
  if (!(length > 1e-9)) return out
  const u = norm(d)
  const abs = [Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])]
  let k = 0
  for (let i = 1; i < 3; i++) if (abs[i] < abs[k]) k = i
  const e: V = [0, 0, 0]
  e[k] = 1
  const v = norm(cross(u, e))
  const w = cross(u, v)
  arc(out, a, v, w, r, 0, 2 * Math.PI, CAPSULE_SEGMENTS)
  arc(out, b, v, w, r, 0, 2 * Math.PI, CAPSULE_SEGMENTS)
  for (const side of [v, w, [-v[0], -v[1], -v[2]] as V, [-w[0], -w[1], -w[2]] as V])
    out.push(
      a.x + r * side[0],
      a.y + r * side[1],
      a.z + r * side[2],
      b.x + r * side[0],
      b.y + r * side[1],
      b.z + r * side[2]
    )
  return out
}

// 충돌체 하나의 몸체 틀 선분(같은 충돌체·정규 껍질 객체면 같은 배열)
export function colliderSegments(
  collider: SimCollider,
  hull: Hull | null = null
): readonly number[] {
  const cached = segmentCache.get(collider)
  if (cached) return cached
  let segments: number[]
  if (collider.kind === 'convex') {
    const shape = hull ?? canonicalHull(collider.points)
    segments = shape ? hullSegments(shape) : []
  } else if (collider.kind === 'box')
    segments = hullSegments(boxHull(collider.center, collider.rotation, collider.half))
  else if (collider.kind === 'cylinder')
    segments = cylinderSegments(collider.a, collider.b, collider.radius)
  else segments = capsuleSegments(collider.a, collider.b, collider.radius)
  segmentCache.set(collider, segments)
  return segments
}

// ---- 대상 ----

// 대상 규칙이 쓰는 몸체 번호: 관절 몸체 순번의 관절 오브젝트와 오브젝트 → 몸체(없으면 섀시 −1)
export type GizmoBodyNumbers = {
  objectIds: readonly string[]
  bodyOf: ReadonlyMap<string, number>
}

// 실행의 몸체 번호(run.joints 순번, run.colliders의 body가 이 번호다): 오브젝트마다 자신 또는 가장 가까운 상위 가운데 run.joints에 든
// 것, 없으면 섀시 −1. 실행 중에도 편집할 수 있어 문서의 관절 번호(jointBodyFrames)는 INIT 때와 다를 수 있다(앞에 관절을 붙이거나
// 떼면 번호가 밀린다, 5 리뷰)
export function runBodyNumbers(
  objects: SceneObjects,
  robotId: string,
  jointIds: readonly string[]
): GizmoBodyNumbers {
  const index = new Map(jointIds.map((id, i) => [id, i]))
  const bodyOf = new Map<string, number>()
  for (const id of subtreeIds(objects, robotId)) {
    if (id === robotId) continue
    let body = -1
    for (const candidate of [id, ...ancestorIds(objects, id)]) {
      if (candidate === robotId) break
      const k = index.get(candidate)
      if (k !== undefined) {
        body = k
        break
      }
    }
    bodyOf.set(id, body)
  }
  return { objectIds: jointIds, bodyOf }
}

// 그 로봇의 몸체 번호: 그 로봇을 잠그는 실행이면 실행의 번호(그리기가 run.colliders·run.joints를 쓰므로), 아니면 문서의 번호
export function gizmoBodyNumbers(
  objects: SceneObjects,
  robotId: string,
  run: PlayRun | null,
  documentJoints: JointBodyFrames | null
): GizmoBodyNumbers | null {
  if (runLocksField(run) && run.robotId === robotId)
    return runBodyNumbers(objects, robotId, run.joints)
  return documentJoints
}

// 로봇마다 그릴 몸체 번호(고른 오브젝트들의 몸체, 하위 관절 몸체 포함, 로봇을 고르면 그 로봇의 모든 몸체). 번호는 bodiesOf가 정한다
// (잠그는 실행이면 실행의 번호, gizmoBodyNumbers)
export function colliderGizmoTargets(
  objects: SceneObjects,
  selectedIds: readonly string[],
  bodiesOf: (robotId: string) => GizmoBodyNumbers | null
): Map<string, number[]> {
  const byRobot = new Map<string, Set<number>>()
  for (const id of selectedIds) {
    if (!objects[id]) continue
    const robotId = findRobotId(objects, id)
    if (!robotId) continue
    const joints = bodiesOf(robotId)
    if (!joints) continue
    let set = byRobot.get(robotId)
    if (!set) byRobot.set(robotId, (set = new Set()))
    if (id === robotId) {
      set.add(-1)
      joints.objectIds.forEach((_, i) => set!.add(i))
      continue
    }
    set.add(joints.bodyOf.get(id) ?? -1)
    joints.objectIds.forEach((jointId, i) => {
      if (ancestorIds(objects, jointId).includes(id)) set!.add(i)
    })
  }
  const out = new Map<string, number[]>()
  for (const [robotId, set] of byRobot)
    out.set(
      robotId,
      [...set].sort((a, b) => a - b)
    )
  return out
}

// ---- 자세와 그리기 목록 ----

// 몸체 틀 표시 행렬: 섀시는 로봇의 표시 행렬, 관절 몸체는 관절 오브젝트의 표시 행렬 · 앵커(sensorGizmoPose와 같다)
function bodyMatrix(
  objects: SceneObjects,
  robotId: string,
  jointObjectId: string | null,
  override: RootOverride | null
): Matrix4 | null {
  if (jointObjectId === null) return worldMatrix(objects, robotId, override)
  const joint = objects[jointObjectId]?.joint
  if (!joint) return null
  const [ax, ay, az] = sanitizeJoint(joint).anchor
  return worldMatrix(objects, jointObjectId, override).multiply(
    new Matrix4().makeTranslation(ax, ay, az)
  )
}

const itemOf = (
  entry: WorldColliderEntry,
  style: ColliderGizmoStyle,
  key: string
): ColliderGizmoItem => ({ key, style, segments: colliderSegments(entry.collider, entry.hull) })

// 그릴 몸체 목록(spec-5 §7):
// - 그 로봇의 잠그는 실행이면 run.colliders(INIT 때의 형상)를 표시 자세 몸체 틀로 그린다(실행 중 바꾼 문서 Collider는 다음 INIT부터라
//   그리지 않는다). 몸체 오브젝트가 숨었으면 그 몸체를 그리지 않는다
// - 아니면 문서 충돌 모델(끈 Collider는 흐린 색, 대체 상자는 점선, 활성 오브젝트의 Collider는 강조)을 문서 몸체 틀과 관절 미리보기
//   값으로 그린다. 사용자 Collider는 붙인 오브젝트가 숨었으면, 자동·대체 껍질은 몸체 오브젝트가 숨었으면 그리지 않는다(F23)
export function colliderGizmoBodies(input: {
  objects: SceneObjects
  targets: ReadonlyMap<string, readonly number[]>
  models: (robotId: string) => { model: CollisionModel; joints: JointBodyFrames } | null
  play: Pick<PlayData, 'run' | 'simPose'>
  preview: JointPreviewState
  visibility: VisibilityState
  activeId: string | null
}): ColliderGizmoBody[] {
  const { objects, targets, models, play, preview, visibility, activeId } = input
  const hidden = (id: string): boolean => !objects[id] || isHiddenInScene(visibility, objects, id)
  const out: ColliderGizmoBody[] = []
  for (const [robotId, bodies] of targets) {
    if (!objects[robotId]) continue
    const override = sensorDisplayOverride(objects, robotId, play, preview)
    const run: PlayRun | null = play.run
    if (runLocksField(run) && run.robotId === robotId) {
      for (const body of bodies) {
        const entry = run.colliders.find((collider) => collider.body === body)
        if (!entry || hidden(entry.objectId)) continue
        const jointId = body < 0 ? null : (run.joints[body] ?? null)
        if (body >= 0 && jointId === null) continue
        const matrix = bodyMatrix(objects, robotId, jointId, override)
        if (!matrix) continue
        out.push({
          key: `${robotId}:run:${body}`,
          robotId,
          body,
          matrix,
          items: entry.colliders.map((collider, k) => ({
            key: `run:${k}`,
            style: 'normal',
            segments: colliderSegments(collider)
          }))
        })
      }
      continue
    }
    const collision = models(robotId)
    if (!collision) continue
    for (const body of bodies) {
      const entry = collision.model.bodies.find((candidate) => candidate.body === body)
      if (!entry) continue
      const jointId = body < 0 ? null : collision.joints.objectIds[body]
      const matrix = bodyMatrix(objects, robotId, jointId, override)
      if (!matrix) continue
      const items: ColliderGizmoItem[] = []
      // 자동 볼록 껍질·섀시 대체 상자(몸체 오브젝트가 숨었으면 그리지 않는다)
      if ((entry.source === 'auto' || entry.source === 'fallback') && !hidden(entry.objectId))
        entry.colliders.forEach((collider, k) =>
          items.push(
            itemOf(
              collider,
              entry.source === 'fallback' ? 'fallback' : 'normal',
              `${entry.source}:${k}`
            )
          )
        )
      // 사용자 Collider(붙인 오브젝트가 숨었으면 그리지 않는다). 끈 것과 한도로 세계 설명에서 뺀 것은 흐린 색이다
      for (const state of entry.states) {
        if (!state.entry || hidden(state.objectId)) continue
        const style: ColliderGizmoStyle =
          !state.enabled || state.capped
            ? 'disabled'
            : state.objectId === activeId
              ? 'active'
              : 'normal'
        items.push(itemOf(state.entry, style, `${state.objectId}:${state.colliderId}`))
      }
      if (items.length > 0)
        out.push({ key: `${robotId}:${entry.objectId}`, robotId, body, matrix, items })
    }
  }
  return out
}
