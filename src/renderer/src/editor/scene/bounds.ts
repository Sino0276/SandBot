import { Box3, Vector3 } from 'three'
import { ROBOT_SIZE } from '../../scene/coordinates'
import { getGeometry } from '../../scene/geometryRegistry'
import { subtreeIds, worldMatrix, type SceneObjects } from '../../scene/model'

// 임시 모양의 로컬 경계 상자(SceneObjectsView의 모양과 맞춘다)
const PLACEHOLDER_BOUNDS = {
  robot: new Box3(
    new Vector3(-ROBOT_SIZE / 2, -ROBOT_SIZE / 2, 0),
    new Vector3(ROBOT_SIZE / 2, ROBOT_SIZE / 2, ROBOT_SIZE)
  ),
  webcam: new Box3(new Vector3(-0.015, -0.045, -0.015), new Vector3(0.026, 0.045, 0.015))
}

// 오브젝트와 하위 오브젝트 모양 전체의 필드 기준 경계 상자. 모양이 없으면 null.
export function objectWorldBounds(objects: SceneObjects, id: string): Box3 | null {
  const bounds = new Box3()
  for (const objectId of subtreeIds(objects, id)) {
    const visual = objects[objectId].visual
    let local: Box3 | null = null
    if (visual?.type === 'mesh') {
      const geometry = getGeometry(visual.geometryId)
      if (geometry && !geometry.boundingBox) geometry.computeBoundingBox()
      local = geometry?.boundingBox ?? null
    } else if (visual?.type === 'placeholder') {
      local = PLACEHOLDER_BOUNDS[visual.shape]
    }
    if (local) bounds.union(local.clone().applyMatrix4(worldMatrix(objects, objectId)))
  }
  return bounds.isEmpty() ? null : bounds
}
