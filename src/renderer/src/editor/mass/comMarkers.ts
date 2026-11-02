import type { MassModel } from '../../mass/types'
import { findRobotId, type SceneObjects, type Vec3 } from '../../scene/model'

// 씬 뷰 무게중심 표시(CenterOfMassIndicator)가 그릴 것. 활성 오브젝트가 속한 로봇의 무게중심과 활성 오브젝트 하위 전체의
// 무게중심이다(질량 모델의 결과 그대로, 질량이 0이거나 계산이 없으면 그리지 않는다).

// 그릴 표시. 위치는 frameId(로봇) 좌표, 로봇 밖 오브젝트면 frameId가 null이고 필드 좌표다.
export type ComMarkers = {
  frameId: string | null
  robot: Vec3 | null
  object: Vec3 | null
}

export function comMarkers(
  objects: SceneObjects,
  model: MassModel,
  selectedId: string | null
): ComMarkers | null {
  if (selectedId === null || !objects[selectedId]) return null
  const robotId = findRobotId(objects, selectedId)
  const robotMass = robotId ? model.robots[robotId] : undefined
  const objectMass = model.objects[selectedId]
  const robot = robotMass && robotMass.mass > 0 ? robotMass.centerOfMass : null
  // 로봇을 골랐으면 로봇 표시만(둘이 같은 자리다)
  const object =
    selectedId !== robotId && objectMass && objectMass.mass > 0 ? objectMass.centerOfMass : null
  if (!robot && !object) return null
  return { frameId: robotId, robot, object }
}
