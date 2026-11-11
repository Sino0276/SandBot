import type { MeshHull } from '../cad/stepImport'
import type { Vec3 } from '../../../shared/sim/worldSpec'
import { getGeometry, meshHull } from './geometryRegistry'
import { PLACEHOLDER_BOUNDS } from './localBounds'
import type { SceneObjects } from './model'

// 오브젝트 하나의 충돌 형상 점(spec-5 §5.3): 메시는 STEP 워커가 만든 메시 껍질(geometryRegistry meshHull)을 읽기만 하고(렌더러
// 메인 스레드는 메시 꼭짓점을 훑지 않는다), 임시 모양은 PLACEHOLDER_BOUNDS(scene/localBounds.ts) 상자 8꼭짓점이다(임시 상자
// 로봇도 18 in 상자 섀시를 갖는다). 씬 문서 밖(geometryRegistry)을 읽으므로 순수 계산(play/worldColliders.ts)에는 조회
// 함수(ColliderShapeLookup)로 넘긴다.

export type ObjectHullPoints =
  // 오브젝트 로컬(피벗 기준), error: 그 메시 껍질의 오차(m)
  | { kind: 'points'; points: readonly Vec3[]; error: number }
  // 메시는 있으나 껍질이 퇴화(평평함·얇음)
  | { kind: 'degenerate' }
  // 형상을 읽는 중이거나 읽지 못함(getGeometry undefined)
  | { kind: 'pending' }
  // 모양 없음(그룹 등)
  | { kind: 'none' }

export type ColliderShapeLookup = (objectId: string) => ObjectHullPoints

const DEGENERATE: ObjectHullPoints = { kind: 'degenerate' }
const PENDING: ObjectHullPoints = { kind: 'pending' }
const NONE: ObjectHullPoints = { kind: 'none' }

// 메시 껍질 → 점(껍질 객체마다 한 번, 같은 껍질이면 같은 결과 객체라 위에서 참조로 비교할 수 있다)
const fromHull = new WeakMap<MeshHull, ObjectHullPoints>()

function hullPoints(hull: MeshHull): ObjectHullPoints {
  const cached = fromHull.get(hull)
  if (cached) return cached
  let result: ObjectHullPoints
  if (hull.points.length === 0) result = DEGENERATE
  else {
    const points: Vec3[] = []
    for (let i = 0; i < hull.points.length; i += 3)
      points.push({ x: hull.points[i], y: hull.points[i + 1], z: hull.points[i + 2] })
    result = { kind: 'points', points, error: hull.error }
  }
  fromHull.set(hull, result)
  return result
}

// 임시 모양 상자 8꼭짓점(꼭짓점 k의 비트 0·1·2가 x·y·z의 +쪽, 오차 0)
function boxPoints(shape: keyof typeof PLACEHOLDER_BOUNDS): ObjectHullPoints {
  const { min, max } = PLACEHOLDER_BOUNDS[shape]
  const points: Vec3[] = []
  for (let k = 0; k < 8; k++)
    points.push({ x: k & 1 ? max.x : min.x, y: k & 2 ? max.y : min.y, z: k & 4 ? max.z : min.z })
  return { kind: 'points', points, error: 0 }
}
const PLACEHOLDER_POINTS = { robot: boxPoints('robot'), webcam: boxPoints('webcam') }

export function objectHullPoints(objects: SceneObjects, id: string): ObjectHullPoints {
  const visual = objects[id]?.visual
  if (!visual) return NONE
  if (visual.type === 'placeholder') return PLACEHOLDER_POINTS[visual.shape]
  // 형상과 껍질은 같은 id·수명으로 등록된다(cad/importStep.ts registerModelGeometries). 형상이 없거나 껍질 정보 없이 등록된
  // 형상은 읽는 중으로 본다
  if (!getGeometry(visual.geometryId)) return PENDING
  const hull = meshHull(visual.geometryId)
  return hull ? hullPoints(hull) : PENDING
}
