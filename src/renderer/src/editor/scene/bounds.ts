import { Box3, Vector3 } from 'three'
import { ROBOT_SIZE } from '../../scene/coordinates'
import { getGeometry } from '../../scene/geometryRegistry'
import { selectionRoots } from '../../scene/hierarchy'
import { subtreeIds, worldMatrix, type RootOverride, type SceneObjects } from '../../scene/model'

// 임시 모양의 로컬 경계 상자(SceneObjectsView의 모양과 맞춘다)
const PLACEHOLDER_BOUNDS = {
  robot: new Box3(
    new Vector3(-ROBOT_SIZE / 2, -ROBOT_SIZE / 2, 0),
    new Vector3(ROBOT_SIZE / 2, ROBOT_SIZE / 2, ROBOT_SIZE)
  ),
  webcam: new Box3(new Vector3(-0.015, -0.045, -0.015), new Vector3(0.026, 0.045, 0.015))
}

// 오브젝트와 하위 오브젝트 모양 전체의 필드 기준 경계 상자. 모양이 없으면 null.
// rootOverride: 실행 중인 로봇을 표시 자세(시뮬레이터 자세)로 계산한다(scene/model.ts worldMatrix).
// include: 넣을 오브젝트만 고른다(잔상이 숨긴 오브젝트를 빼려고). 없으면 하위 전체.
export function objectWorldBounds(
  objects: SceneObjects,
  id: string,
  rootOverride: RootOverride | null = null,
  include?: (objectId: string) => boolean
): Box3 | null {
  const bounds = new Box3()
  for (const objectId of subtreeIds(objects, id)) {
    if (include && !include(objectId)) continue
    const visual = objects[objectId].visual
    let local: Box3 | null = null
    if (visual?.type === 'mesh') {
      const geometry = getGeometry(visual.geometryId)
      if (geometry && !geometry.boundingBox) geometry.computeBoundingBox()
      local = geometry?.boundingBox ?? null
    } else if (visual?.type === 'placeholder') {
      local = PLACEHOLDER_BOUNDS[visual.shape]
    }
    if (local)
      bounds.union(local.clone().applyMatrix4(worldMatrix(objects, objectId, rootOverride)))
  }
  return bounds.isEmpty() ? null : bounds
}

// 여러 오브젝트(F 키의 선택 전체)를 합친 필드 기준 경계 상자. 모양이 없는 오브젝트는 원점 한 점으로 넣는다.
// 다른 선택의 하위인 것은 상위 경계에 이미 들어 있으므로 다시 훑지 않는다(큰 CAD에서 범위 선택).
// 있는 오브젝트가 하나도 없으면 null. rootOverride는 objectWorldBounds와 같다(실행 중 F가 실제 자세로 간다).
export function selectionWorldBounds(
  objects: SceneObjects,
  ids: readonly string[],
  rootOverride: RootOverride | null = null
): Box3 | null {
  const bounds = new Box3()
  let found = false
  for (const id of selectionRoots(objects, ids)) {
    found = true
    const own = objectWorldBounds(objects, id, rootOverride)
    if (own) bounds.union(own)
    else
      bounds.expandByPoint(
        new Vector3().setFromMatrixPosition(worldMatrix(objects, id, rootOverride))
      )
  }
  return found ? bounds : null
}
