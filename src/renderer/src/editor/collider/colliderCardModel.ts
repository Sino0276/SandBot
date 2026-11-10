import { Matrix4, Vector3 } from 'three'
import { getGeometry } from '../../scene/geometryRegistry'
import {
  COLLIDER_DIRECTIONS,
  MAX_OBJECT_COLLIDERS,
  defaultBox,
  defaultCapsule,
  defaultMesh,
  type ColliderBounds,
  type ColliderDirection,
  type ColliderKind,
  type ColliderSettings
} from '../../scene/collider'
import { objectLocalBounds } from '../../scene/localBounds'
import {
  childrenInDocument,
  findRobotId,
  frameMatrix,
  transformToMatrix,
  worldMatrix,
  type SceneObject,
  type SceneObjects
} from '../../scene/model'
import type { CollisionModel, ColliderState, WorldColliderBody } from '../../play/worldColliders'
import type { JointBodyFrames } from '../../play/worldJoints'
import { parseLength, toDisplayLength, type LengthUnit } from '../../units/units'

// Collider 카드(spec-5 §6.1·6.2)의 순수 모델: Add Component 기본값(하위 경계 상자, 로봇 위 축), [하위에 맞추기], 카드 줄(소속 몸체,
// 결과, 다른 몸체 메시, 자동 껍질 대체). 렌더러 메인 스레드에서 부르므로 메시 꼭짓점·껍질을 훑지 않고 형상의 boundingBox
// 8꼭짓점만 쓴다(큰 CAD에서 클릭이 멈추지 않게, F4·C-H3).

// 길이 입력칸: 단위를 붙인 입력도 받아 표시 단위 값으로 읽고, [min, max](m) 밖이면 받지 않는다(null: 칸이 틀렸다고 보인다)
export function colliderLengthParser(
  unit: LengthUnit,
  min: number,
  max: number
): (text: string) => number | null {
  return (text) => {
    const meters = parseLength(text, unit)
    return meters === null || meters < min || meters > max ? null : toDisplayLength(meters, unit)
  }
}

// Collider를 더 붙일 수 있는지(Unity처럼 여러 개, 한 오브젝트 MAX_OBJECT_COLLIDERS개까지)
export function canAddCollider(object: SceneObject): boolean {
  return (object.colliders?.length ?? 0) < MAX_OBJECT_COLLIDERS
}

// 오브젝트의 몸체(로봇 밖이면 null, 몸체 나누기는 jointBodyFrames)
function bodyOfObject(
  objects: SceneObjects,
  id: string,
  joints: JointBodyFrames | null
): number | null {
  if (!joints || !findRobotId(objects, id)) return null
  return joints.bodyOf.get(id) ?? null
}

// 오브젝트 틀의 하위 경계 상자(spec-5 §1.2): 하위(자신 포함) 가운데 같은 몸체 오브젝트마다 형상의 boundingBox 8꼭짓점을 오브젝트
// 틀로 옮겨 합친 축 정렬 경계. 형상을 읽지 않은 메시(getGeometry 없음)는 빼고 pending에 센다. 하나도 없으면 bounds null.
// joints가 null이면(로봇 밖) 하위 전체다.
export function colliderFitBounds(
  objects: SceneObjects,
  id: string,
  joints: JointBodyFrames | null
): { bounds: ColliderBounds; pending: number } {
  const body = bodyOfObject(objects, id, joints)
  const sameBody = (childId: string): boolean =>
    body === null || (joints?.bodyOf.get(childId) ?? -1) === body
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let pending = 0
  const corner = new Vector3()
  const visit = (current: string, matrix: Matrix4): void => {
    const visual = objects[current].visual
    if (visual) {
      const box = objectLocalBounds(objects, current)
      if (box) {
        for (let k = 0; k < 8; k++) {
          corner
            .set(
              k & 1 ? box.max.x : box.min.x,
              k & 2 ? box.max.y : box.min.y,
              k & 4 ? box.max.z : box.min.z
            )
            .applyMatrix4(matrix)
          const p = [corner.x, corner.y, corner.z]
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], p[axis])
            max[axis] = Math.max(max[axis], p[axis])
          }
        }
      } else if (visual.type === 'mesh' && !getGeometry(visual.geometryId)) pending++
    }
    for (const child of childrenInDocument(objects, current))
      if (sameBody(child.id))
        visit(child.id, matrix.clone().multiply(transformToMatrix(child.transform)))
  }
  if (objects[id]) visit(id, new Matrix4())
  if (!(min[0] <= max[0])) return { bounds: null, pending }
  return {
    bounds: { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] },
    pending
  }
}

// 오브젝트 로컬 축 가운데 로봇 +Z와 가장 나란한 축(|R_robot←obj[:,k]·ẑ| 최대, 같으면 x → y → z, F13). 로봇 밖이면 필드 +Z
export function robotUpAxis(objects: SceneObjects, id: string): ColliderDirection {
  if (!objects[id]) return 'z'
  const e = frameMatrix(objects, id, 'robot').invert().multiply(worldMatrix(objects, id)).elements
  // 열 k의 z 성분(열 우선 배열: 열 k는 e[4k..4k+2])
  const zOf = [Math.abs(e[2]), Math.abs(e[6]), Math.abs(e[10])]
  let best = 0
  for (let k = 1; k < 3; k++) if (zOf[k] > zOf[best]) best = k
  return COLLIDER_DIRECTIONS[best]
}

// Add Component의 새 Collider(spec-5 §1.2 추가할 때의 기본값)
export function newCollider(
  objects: SceneObjects,
  id: string,
  kind: ColliderKind,
  joints: JointBodyFrames | null,
  createId: () => string
): ColliderSettings {
  const colliderId = createId()
  if (kind === 'mesh') return defaultMesh(colliderId)
  const { bounds } = colliderFitBounds(objects, id, joints)
  return kind === 'box'
    ? defaultBox(colliderId, bounds)
    : defaultCapsule(colliderId, bounds, robotUpAxis(objects, id))
}

// [하위에 맞추기](Box·Capsule): 기본값 규칙으로 크기·중심을 다시 맞춘다(id·켬·마찰은 그대로). 하위 형상이 없으면 null
export function fitCollider(
  objects: SceneObjects,
  id: string,
  collider: Extract<ColliderSettings, { kind: 'box' | 'capsule' }>,
  joints: JointBodyFrames | null
): ColliderSettings | null {
  const { bounds } = colliderFitBounds(objects, id, joints)
  if (!bounds) return null
  const tail = {
    ...(collider.enabled === false ? { enabled: false as const } : {}),
    ...(collider.friction !== undefined ? { friction: collider.friction } : {})
  }
  if (collider.kind === 'box') {
    const { center, size } = defaultBox(collider.id, bounds)
    return { id: collider.id, kind: 'box', ...tail, center, size }
  }
  const fitted = defaultCapsule(collider.id, bounds, collider.direction)
  return {
    id: collider.id,
    kind: 'capsule',
    ...tail,
    center: fitted.center,
    radius: fitted.radius,
    height: fitted.height,
    direction: fitted.direction
  }
}

// ---- 카드 줄 ----

export type ColliderMembership =
  | { kind: 'chassis'; body: WorldColliderBody | null }
  | { kind: 'joint'; body: WorldColliderBody | null; name: string }
  | { kind: 'orphan' }

export type ColliderCardView = {
  membership: ColliderMembership
  // 이 Collider의 상태(모델에 없으면 null: 로봇 밖이거나 한도 밖 관절)
  state: ColliderState | null
  // 하위 메시가 모두 다른(관절) 몸체에 있을 때 그 관절 이름(하위 메시가 가장 많은 관절, 같으면 앞 순번)
  meshesInOtherBody: string | null
  // 그 몸체의 Collider가 이 카드 하나뿐이면 그 몸체 이름(자동 껍질을 쓰지 않는다는 안내)
  replacesAuto: string | null
}

export function colliderCardView(
  objects: SceneObjects,
  objectId: string,
  colliderId: string,
  collision: { model: CollisionModel; joints: JointBodyFrames } | null
): ColliderCardView {
  const joints = collision?.joints ?? null
  const body = bodyOfObject(objects, objectId, joints)
  if (body === null || !collision)
    return {
      membership: { kind: 'orphan' },
      state: null,
      meshesInOtherBody: null,
      replacesAuto: null
    }
  const bodyEntry = collision.model.bodies.find((entry) => entry.body === body) ?? null
  const membership: ColliderMembership =
    body < 0
      ? { kind: 'chassis', body: bodyEntry }
      : {
          kind: 'joint',
          body: bodyEntry,
          name: bodyEntry?.name ?? objects[joints!.objectIds[body]].name
        }
  const state =
    bodyEntry?.states.find(
      (entry) => entry.objectId === objectId && entry.colliderId === colliderId
    ) ?? null
  // 하위 메시: 같은 몸체 메시가 하나도 없고 다른 몸체 메시가 있으면 경고
  let own = 0
  const others = new Map<number, number>()
  const walk = (id: string): void => {
    if (objects[id].visual) {
      const owner = joints!.bodyOf.get(id) ?? -1
      if (owner === body) own++
      else others.set(owner, (others.get(owner) ?? 0) + 1)
    }
    for (const child of childrenInDocument(objects, id)) walk(child.id)
  }
  walk(objectId)
  let meshesInOtherBody: string | null = null
  if (own === 0 && others.size > 0) {
    let best: number | null = null
    for (const [owner, count] of others)
      if (
        owner >= 0 &&
        (best === null ||
          count > others.get(best)! ||
          (count === others.get(best)! && owner < best))
      )
        best = owner
    if (best !== null)
      meshesInOtherBody =
        collision.model.bodies.find((entry) => entry.body === best)?.name ??
        objects[joints!.objectIds[best]].name
  }
  const replacesAuto = bodyEntry && bodyEntry.states.length === 1 && state ? bodyEntry.name : null
  return { membership, state, meshesInOtherBody, replacesAuto }
}
