import type { Vec3 } from '../../../shared/sim/worldSpec'
import type { SceneObjects } from './model'

// 오브젝트 하나의 충돌 형상 점(spec-5 §5.3): 메시는 STEP 워커가 만든 메시 껍질(geometryRegistry meshHull)을 읽기만 하고(렌더러
// 메인 스레드는 메시 꼭짓점을 훑지 않는다), 임시 모양은 PLACEHOLDER_BOUNDS(scene/localBounds.ts) 상자 8꼭짓점이다.
//
// 계약 커밋: 타입과 서명만 있다(objectHullPoints는 늘 'none'). 5 B가 구현한다.

export type ObjectHullPoints =
  // 오브젝트 로컬(피벗 기준), error: 그 메시 껍질의 오차(m)
  | { kind: 'points'; points: readonly Vec3[]; error: number }
  // 메시는 있으나 껍질이 퇴화(평평함·얇음)
  | { kind: 'degenerate' }
  // 형상을 읽는 중이거나 읽지 못함(getGeometry undefined)
  | { kind: 'pending' }
  // 모양 없음(그룹 등)
  | { kind: 'none' }

export function objectHullPoints(objects: SceneObjects, id: string): ObjectHullPoints {
  void objects
  void id
  return { kind: 'none' }
}

export type ColliderShapeLookup = (objectId: string) => ObjectHullPoints
