import { Box3, Vector3 } from 'three'
import { ROBOT_SIZE } from './coordinates'
import { getGeometry } from './geometryRegistry'
import type { SceneObjects } from './model'

// 임시 모양의 로컬 경계 상자(SceneObjectsView의 모양과 맞춘다)
export const PLACEHOLDER_BOUNDS = {
  robot: new Box3(
    new Vector3(-ROBOT_SIZE / 2, -ROBOT_SIZE / 2, 0),
    new Vector3(ROBOT_SIZE / 2, ROBOT_SIZE / 2, ROBOT_SIZE)
  ),
  webcam: new Box3(new Vector3(-0.015, -0.045, -0.015), new Vector3(0.026, 0.045, 0.015))
}

// 오브젝트 자신의 모양(하위 제외)의 로컬 경계 상자. 모양이 없거나, CAD 형상을 아직 읽지 않았거나, 형상이 비었으면
// null. 씬 문서 밖(geometryRegistry)을 읽으므로 순수 계산(세계 빌더 등)에는 인자로 넘긴다(hardware/mounting.ts
// LocalBoundsLookup). 돌려주는 상자는 형상이 가진 것 그대로라 바꾸지 않는다.
export function objectLocalBounds(objects: SceneObjects, id: string): Box3 | null {
  const visual = objects[id]?.visual
  if (visual?.type === 'mesh') {
    // 형상 id는 오브젝트 id가 아니라 visual.geometryId다(cadGeometryId)
    const geometry = getGeometry(visual.geometryId)
    if (!geometry) return null
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const box = geometry.boundingBox
    return box && !box.isEmpty() ? box : null
  }
  if (visual?.type === 'placeholder') return PLACEHOLDER_BOUNDS[visual.shape]
  return null
}
