import { trueIntrinsics, type CameraModelId } from '../../../../shared/sim/cameraData'
import type { SensorMountInRobot } from '../../hardware/mounting'
import type { SceneObjects } from '../../scene/model'
import { cameraOuterRays, PREVIEW_HEIGHT, PREVIEW_WIDTH } from '../scene/cameraGizmoModel'
import { castSelfHit, memoSelfHit, type SelfHit } from './sensorSelfHit'

// 웹캠의 자기 로봇 가림(4d, spec-4d §1.15). 4c 센서 자기 가림(editor/hardware/sensorSelfHit.ts castSelfHit, 메시 BVH 광선)으로
// VisionPortal 기본 640×480 절두체의 9광선(광축, 네 모서리, 네 변 가운데)을 렌즈(하우징 앞면)에서 쏜다. 광축이 맞으면
// axis(파트·거리), 그 밖만 맞으면 partial이다. 시뮬레이터에는 로봇 형상이 없으므로 경고만 한다(인스펙터 꼬리, INIT Console
// worldCameraSelfHit).

// 광선 길이(m) [결정: spec-4d §1.15의 1.2 m — 필드 안에서 태그를 보는 거리(약 1–2 m)의 앞쪽이고, 자기 로봇(18 in 안)을
// 넉넉히 덮는다]
export const CAMERA_SELF_HIT_REACH = 1.2

export function cameraSelfHit(
  objects: SceneObjects,
  robotId: string,
  cameraObjectId: string,
  mount: Pick<SensorMountInRobot, 'position' | 'rotation'>,
  model: CameraModelId
): SelfHit | null {
  const lens = trueIntrinsics(model, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  return castSelfHit(
    objects,
    robotId,
    cameraObjectId,
    mount,
    cameraOuterRays(lens, PREVIEW_WIDTH, PREVIEW_HEIGHT),
    CAMERA_SELF_HIT_REACH
  )
}

// componentId마다 마지막 결과(4c selfHitFor와 같은 기억: 문서·형상 revision·장착·모델이 같으면 다시 쏘지 않고, 핸들 드래그
// 중에는 마지막 결과를 쓰고 끝날 때 한 번 다시 — useSelfHitRefresh)
export function cameraSelfHitFor(
  componentId: string,
  objects: SceneObjects,
  revision: number,
  robotId: string,
  cameraObjectId: string,
  mount: Pick<SensorMountInRobot, 'position' | 'rotation'>,
  model: CameraModelId
): SelfHit | null {
  const key = JSON.stringify([
    'webcam',
    robotId,
    cameraObjectId,
    mount.position,
    mount.rotation,
    model
  ])
  return memoSelfHit(componentId, objects, revision, key, () =>
    cameraSelfHit(objects, robotId, cameraObjectId, mount, model)
  )
}
