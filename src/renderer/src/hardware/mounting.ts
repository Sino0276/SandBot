import { findRobotId, getTransformInFrame, type SceneObjects, type Vec3 } from '../scene/model'
import type { HUB_DIRECTIONS } from './catalog'

// 장치가 로봇에 달린 위치·방향에서 SDK가 요구하는 설정값을 계산한다.
// 로봇 좌표계는 X 앞, Y 왼쪽, Z 위, 원점은 로봇 중심 바닥(CLAUDE.md 좌표계 결정).

export const MM_PER_METER = 1000
export const INCH_PER_METER = 1 / 0.0254
const RAD_TO_DEG = 180 / Math.PI

// 오브젝트(파트 피벗)의 로봇 기준 위치(미터)와 요(라디안). 로봇에 속하지 않으면 null.
export function robotFramePose(
  objects: SceneObjects,
  objectId: string
): { x: number; y: number; z: number; yaw: number } | null {
  if (!objects[objectId]) return null
  const { position, rotation } = getTransformInFrame(objects, objectId, 'robot')
  return { x: position[0], y: position[1], z: position[2], yaw: rotation[2] }
}

// goBILDA Pinpoint setOffsets(x, y, DistanceUnit.MM) 값.
// SDK 주석: X 오프셋 = 앞뒤를 재는 X 포드가 추적 중심에서 옆으로 떨어진 거리(왼쪽 +),
//          Y 오프셋 = 좌우를 재는 Y 포드가 앞으로 떨어진 거리(앞 +). 추적 중심은 로봇 원점이다.
export function pinpointOffsetsMm(
  objects: SceneObjects,
  xPodObjectId: string,
  yPodObjectId: string
): { x: number; y: number } | null {
  const xPod = robotFramePose(objects, xPodObjectId)
  const yPod = robotFramePose(objects, yPodObjectId)
  if (!xPod || !yPod) return null
  return { x: xPod.y * MM_PER_METER, y: yPod.x * MM_PER_METER }
}

// Pinpoint 컴포넌트의 오프셋. 포드 파트가 없거나 다른 로봇에 있으면 null(검증 경고 pinpointPodMissing).
export function pinpointComponentOffsetsMm(
  objects: SceneObjects,
  objectId: string,
  props: Record<string, string | number>
): { x: number; y: number } | null {
  const robotId = findRobotId(objects, objectId)
  const pod = (id: string | number | undefined): string =>
    typeof id === 'string' &&
    objects[id] &&
    robotId !== null &&
    findRobotId(objects, id) === robotId
      ? id
      : ''
  return pinpointOffsetsMm(objects, pod(props.xPod), pod(props.yPod))
}

// SparkFun OTOS setOffset(new Pose2D(x, y, h)) 값. 드라이버 기본 단위(인치, 도)로 낸다.
// SDK 샘플 규약: X는 로봇 오른쪽 +, Y는 앞 +, h는 반시계 +.
// (예: 왼쪽 5 in, 앞 10 in, 시계 방향 90° → {-5, 10, -90})
export function otosOffsetInchDeg(
  objects: SceneObjects,
  objectId: string,
  mountingAngleDeg: number
): { x: number; y: number; h: number } | null {
  const pose = robotFramePose(objects, objectId)
  if (!pose) return null
  return {
    x: -pose.y * INCH_PER_METER,
    y: pose.x * INCH_PER_METER,
    h: normalizeDegrees(pose.yaw * RAD_TO_DEG + mountingAngleDeg)
  }
}

export function normalizeDegrees(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 && degrees > 0 ? 180 : wrapped
}

export type HubDirection = (typeof HUB_DIRECTIONS)[number]

// RevHubOrientationOnRobot의 방향을 로봇 좌표계 벡터로(LEFT/RIGHT는 로봇 뒤에서 본 방향)
export const HUB_DIRECTION_VECTORS: Record<HubDirection, Vec3> = {
  up: [0, 0, 1],
  down: [0, 0, -1],
  forward: [1, 0, 0],
  backward: [-1, 0, 0],
  left: [0, 1, 0],
  right: [0, -1, 0]
}

// 로고 방향과 USB 방향이 같은 축이면 물리적으로 불가능하다(SDK가 IllegalArgumentException을 던진다)
export function isValidHubOrientation(logo: HubDirection, usb: HubDirection): boolean {
  const a = HUB_DIRECTION_VECTORS[logo]
  const b = HUB_DIRECTION_VECTORS[usb]
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] === 0
}
