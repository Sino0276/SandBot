import { editPoseOverlaps } from '../../../shared/sim/collision3d'
import type { SimCollider, Vec2 } from '../../../shared/sim/worldSpec'
import type { ColliderShapeLookup } from '../scene/meshHull'
import type { SceneObjects } from '../scene/model'
import type { JointBodyFrames } from './worldJoints'
import type { WorldWarning } from './worldSpec'

// 몸체마다 충돌 형상을 정한다(spec-5 §5.4, 순수 함수): 그 몸체 소속 오브젝트의 Collider(끈 것도 "있음"으로 셈), 없으면 몸체 메시의
// 자동 볼록 껍질, 섀시는 그것도 없으면 외곽 대체 상자. 편집 자세에서 겹친 자기 몸체 짝은 앞 계산(editPoseOverlaps)으로 무시 목록에
// 넣고, 로봇의 [그래도 충돌] 짝은 뺀다.
//
// 계약 커밋: 타입과 서명만 있다(buildCollisionModel은 빈 모델). 5 B가 구현한다.

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
  colliders: WorldColliderEntry[]
  // 형상을 읽는 중이거나 못 읽은 그 몸체의 메시 수
  pendingMeshes: number
  // 평평하거나 얇아 뺀 Mesh Collider·자동 껍질 수
  degenerate: number
  // 관절 몸체의 편집 자세 바닥 간격(min z, m, F10), 섀시 null
  floorGap: number | null
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

export function buildCollisionModel(input: {
  objects: SceneObjects
  robotId: string
  joints: JointBodyFrames
  shapes: ColliderShapeLookup
  // robotOutline(play/worldSpec.ts)
  outline: { footprint: Vec2[]; height: number }
  // 시험이 가짜를 넘긴다, 기본은 shared 함수
  overlaps?: typeof editPoseOverlaps
}): CollisionModel {
  void input
  return { bodies: [], pairs: [], staleForced: 0, warnings: [] }
}
