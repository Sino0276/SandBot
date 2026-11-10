import { Vector3 } from 'three'
import {
  DEFAULT_CAMERA_MODEL,
  isCameraModelId,
  type CameraModelId
} from '../../../shared/sim/cameraData'
import type { Vec3 as SimVec3 } from '../../../shared/sim/worldSpec'
import {
  findRobotId,
  frameMatrix,
  getTransformInFrame,
  subtreeIds,
  worldMatrix,
  type HardwareComponent,
  type SceneObjects,
  type Vec3
} from '../scene/model'
import { COMPONENT_TYPES, type HUB_DIRECTIONS } from './catalog'

// 장치가 로봇에 달린 위치·방향에서 SDK가 요구하는 설정값을 계산한다.
// 로봇 좌표계는 X 앞, Y 왼쪽, Z 위, 원점은 로봇 중심 바닥(CLAUDE.md 좌표계 결정).

export const MM_PER_METER = 1000
export const INCH_PER_METER = 1 / 0.0254

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
  const offsets = pinpointOffsetsMeters(objects, xPodObjectId, yPodObjectId)
  return offsets && { x: offsets.x * MM_PER_METER, y: offsets.y * MM_PER_METER }
}

// 같은 값(미터). 코드 단위(hardware/codeUnits.ts)로 바꾸기 전의 값이다.
export function pinpointOffsetsMeters(
  objects: SceneObjects,
  xPodObjectId: string,
  yPodObjectId: string
): { x: number; y: number } | null {
  const xPod = robotFramePose(objects, xPodObjectId)
  const yPod = robotFramePose(objects, yPodObjectId)
  if (!xPod || !yPod) return null
  return { x: xPod.y, y: yPod.x }
}

// Pinpoint 컴포넌트의 오프셋. 포드 파트가 없거나 다른 로봇에 있으면 null(검증 경고 pinpointPodMissing).
export function pinpointComponentOffsetsMm(
  objects: SceneObjects,
  objectId: string,
  props: Record<string, string | number>
): { x: number; y: number } | null {
  const offsets = pinpointComponentOffsetsMeters(objects, objectId, props)
  return offsets && { x: offsets.x * MM_PER_METER, y: offsets.y * MM_PER_METER }
}

// 같은 값(미터)
export function pinpointComponentOffsetsMeters(
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
  return pinpointOffsetsMeters(objects, pod(props.xPod), pod(props.yPod))
}

// SparkFun OTOS setOffset(new Pose2D(x, y, h)) 값. 드라이버 기본 단위(인치, 도)로 낸다.
// SDK 샘플 규약: X는 로봇 오른쪽 +, Y는 앞 +, h는 반시계 +.
// (예: 왼쪽 5 in, 앞 10 in, 시계 방향 90° → {-5, 10, -90})
// 위치는 파트 피벗에서 구하지만, 방향은 장착 각도만 쓴다. CAD 파트의 축은 CAD 파일의 축(정렬 회전)일 뿐
// 센서 화살표 방향과 관계가 없기 때문이다.
export function otosOffsetInchDeg(
  objects: SceneObjects,
  objectId: string,
  mountingAngleDeg: number
): { x: number; y: number; h: number } | null {
  const offset = otosOffsetMetersDeg(objects, objectId, mountingAngleDeg)
  return offset && { x: offset.x * INCH_PER_METER, y: offset.y * INCH_PER_METER, h: offset.h }
}

// 같은 값(위치 미터, h 도). 코드 단위(hardware/codeUnits.ts)로 바꾸기 전의 값이다.
export function otosOffsetMetersDeg(
  objects: SceneObjects,
  objectId: string,
  mountingAngleDeg: number
): { x: number; y: number; h: number } | null {
  const pose = robotFramePose(objects, objectId)
  if (!pose) return null
  return { x: -pose.y, y: pose.x, h: normalizeDegrees(mountingAngleDeg) }
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

// ---- 거리·컬러 센서 장착(4c, spec-4c §1.2) ----

// 조준(rad, 로봇 좌표): yaw는 로봇 +X에서 반시계 +, pitch는 올려본각(위 +)
export type SensorAim = { yaw: number; pitch: number }
export type SensorComponentType = 'distanceSensor' | 'colorSensor'

// 조준 속성을 카탈로그 기본·범위로 읽는다. 없거나 수가 아니거나(NaN 포함) 범위 밖이면 기본값이다(컬러 pitch 기본 −π/2).
// 프로젝트 파일은 parseProps가 같은 규칙으로 채우지만, 메모리 안 컴포넌트(임시 씬, 4c 전에 붙인 컴포넌트)에는 속성이
// 없을 수 있다.
export function sensorAim(type: SensorComponentType, props: HardwareComponent['props']): SensorAim {
  const read = (key: 'aimYaw' | 'aimPitch'): number => {
    const def = COMPONENT_TYPES[type].properties.find((property) => property.key === key)
    if (!def || def.kind !== 'angle') throw new Error(`${type}.${key} 조준 속성이 카탈로그에 없다`)
    const value = props[key]
    return typeof value === 'number' && value >= def.min && value <= def.max ? value : def.default
  }
  return { yaw: read('aimYaw'), pitch: read('aimPitch') }
}

// 센서 틀 회전(ZYX): (0, −pitch, yaw). R_y(θ)·x̂ = (cos θ, 0, −sin θ)이므로 위를 보려면(pitch > 0) rotation.y가 음수다
// (synthesis §4.1). 0은 −0이 되지 않게 둔다(세계 설명·기준 해시가 −0을 다른 글자로 쓰지 않게).
export function aimRotation(aim: SensorAim): SimVec3 {
  return { x: 0, y: aim.pitch === 0 ? 0 : -aim.pitch, z: aim.yaw === 0 ? 0 : aim.yaw }
}

// 조준 축 a = R(aimRotation)·x̂ = Rz(yaw)·Ry(−pitch)·x̂(로봇 좌표 단위 벡터)
function aimAxis(aim: SensorAim): SimVec3 {
  const c = Math.cos(aim.pitch)
  return { x: c * Math.cos(aim.yaw), y: c * Math.sin(aim.yaw), z: Math.sin(aim.pitch) }
}

// 오브젝트 자신의 모양의 로컬 경계 상자(형상이 없거나 아직 읽지 않았으면 null). 렌더러는 scene/localBounds.ts의
// objectLocalBounds다. 형상은 씬 문서 밖이라 순수 계산(세계 빌더)은 이것을 인자로 받는다(null이면 피벗을 쓴다).
export type LocalBoundsLookup = (objectId: string) => { min: SimVec3; max: SimVec3 } | null

export type SensorMountInRobot = {
  // 로봇 좌표의 광선 원점(하우징 앞면)
  position: SimVec3
  // aimRotation(aim) 그대로
  rotation: SimVec3
  // 'front': 형상 경계 상자를 조준 축에 투영해 앞면을 찾았다. 'pivot': 형상을 몰라(또는 robot·CAD 루트에 붙어) 피벗을 썼다
  housing: 'front' | 'pivot'
  // 원점 − 피벗을 조준 축에 투영한 길이(m, ≥ 0). 'pivot'이면 0
  pivotOffset: number
}

// 하우징 앞면이 피벗에서 이보다 멀면 경고한다(m) [가정: REV 두 센서 하우징 깊이 2 cm대의 두 배 남짓. 이보다 멀면
// 센서보다 큰 그룹(인테이크 전체 등)에 붙였을 가능성이 크다]
export const SENSOR_HOUSING_WARN = 0.05

// 하우징 앞면을 찾을 때 볼 형상의 오브젝트들. 자기 모양이 있으면 그것만, 없고 그룹이나 CAD 루트가 아닌 어셈블리면
// 하위의 모양들. robot·CAD 루트(cad 있음)·그 밖은 빈 목록(피벗을 쓴다).
function housingShapeIds(objects: SceneObjects, objectId: string): string[] {
  const object = objects[objectId]
  if (object.kind === 'robot' || object.cad) return []
  if (object.visual) return [objectId]
  if (object.kind !== 'group' && object.kind !== 'assembly') return []
  return subtreeIds(objects, objectId).filter((id) => objects[id].visual)
}

// 센서 오브젝트의 로봇 좌표 장착(편집 자세, 관절 q = 0). 원점은 하우징 앞면이다(REV RevColorSensorV3.getDistance는 "to the
// plastic housing at the front", RevColorSensorV3.java:137–138, ToF도 앞 창 기준. 피벗(경계 상자 중심)을 쓰면 바닥 가까이
// 단 컬러 센서 값이 30–50% 달라진다, critique E13). 형상 경계 상자 8꼭짓점을 로봇 좌표로 옮겨(robotOutline과 같은 방법)
// 조준 축에 투영한 최대가 앞면이다. 로봇 밖 오브젝트면 null.
export function sensorMountInRobot(
  objects: SceneObjects,
  objectId: string,
  aim: SensorAim,
  bounds: LocalBoundsLookup | null
): SensorMountInRobot | null {
  if (!objects[objectId] || findRobotId(objects, objectId) === null) return null
  const pivot = robotFramePose(objects, objectId)
  if (!pivot) return null
  const rotation = aimRotation(aim)
  const axis = aimAxis(aim)
  let best = -Infinity
  if (bounds) {
    for (const id of housingShapeIds(objects, objectId)) {
      const box = bounds(id)
      if (!box) continue
      const toRobot = frameMatrix(objects, id, 'robot').invert().multiply(worldMatrix(objects, id))
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const corner = new Vector3(x, y, z).applyMatrix4(toRobot)
            const along =
              (corner.x - pivot.x) * axis.x +
              (corner.y - pivot.y) * axis.y +
              (corner.z - pivot.z) * axis.z
            if (along > best) best = along
          }
    }
  }
  if (best === -Infinity)
    return {
      position: { x: pivot.x, y: pivot.y, z: pivot.z },
      rotation,
      housing: 'pivot',
      pivotOffset: 0
    }
  const pivotOffset = Math.max(0, best)
  return {
    position: {
      x: pivot.x + axis.x * pivotOffset,
      y: pivot.y + axis.y * pivotOffset,
      z: pivot.z + axis.z * pivotOffset
    },
    rotation,
    housing: 'front',
    pivotOffset
  }
}

// ---- 웹캠 장착(4d, spec-4d §1.3) ----

// 조준(rad, 로봇 좌표): yaw는 로봇 +X에서 반시계 +, pitch는 올려본각(위 +), roll은 광축 둘레(카메라 뒤에서 볼 때 시계 방향 +)
export type CameraAim = { yaw: number; pitch: number; roll: number }

// 웹캠 조준 속성을 카탈로그 기본·범위로 읽는다(sensorAim과 같은 규칙: 없음·NaN·범위 밖이면 기본값, pitch 기본 0(수평))
export function cameraAim(props: HardwareComponent['props']): CameraAim {
  const read = (key: 'aimYaw' | 'aimPitch' | 'aimRoll'): number => {
    const def = COMPONENT_TYPES.webcam.properties.find((property) => property.key === key)
    if (!def || def.kind !== 'angle') throw new Error(`webcam.${key} 조준 속성이 카탈로그에 없다`)
    const value = props[key]
    return typeof value === 'number' && value >= def.min && value <= def.max ? value : def.default
  }
  return { yaw: read('aimYaw'), pitch: read('aimPitch'), roll: read('aimRoll') }
}

// 카메라 틀 회전(ZYX): (roll, −pitch, yaw). R = Rz(yaw)·Ry(−pitch)·Rx(roll)이라 롤은 광축(+X) 둘레 오른손 회전이고,
// 롤 +면 센서 +Z(영상 위)가 −Y 쪽(카메라 뒤에서 볼 때 오른쪽)으로 간다. 0은 −0이 되지 않게 둔다(aimRotation과 같은 규칙).
export function cameraAimRotation(aim: CameraAim): SimVec3 {
  return {
    x: aim.roll === 0 ? 0 : aim.roll,
    y: aim.pitch === 0 ? 0 : -aim.pitch,
    z: aim.yaw === 0 ? 0 : aim.yaw
  }
}

// 웹캠의 카메라 모델(틀리거나 없으면 기본 C920)
export function cameraModelOf(props: HardwareComponent['props']): CameraModelId {
  const value = props.cameraModel
  return isCameraModelId(value) ? value : DEFAULT_CAMERA_MODEL
}

// SDK 로봇 틀(x 오른쪽, y 앞, z 위, 원점 로봇 중심 바닥)의 카메라 위치(in)와 ZXZ 방향(°):
// AprilTagProcessor.Builder.setCameraPose(Position(INCH, x, y, z, 0), YawPitchRollAngles(DEGREES, yaw, pitch, roll, 0))
export type SdkCameraPose = {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
}

const DEGREES_PER_RADIAN = 180 / Math.PI
// −0을 0으로(인스펙터 글자가 "-0.00"이 되지 않게)
const plainZero = (value: number): number => value + 0

// 위치: SandBot 로봇 틀(x 앞, y 왼쪽)에서 SDK 틀로 x_sdk = −y, y_sdk = x, z_sdk = z(in).
// 방향: (yaw, pitch, roll)_SDK = (aimYaw, aimPitch − 90°, aimRoll). SDK R = Rz(yaw)·Rx(pitch)·Rz(roll)(Vision 12.0
// AprilTagProcessor.java:246–260, INTRINSIC ZXZ)은 OpenCV 카메라 축을 SDK 로봇 틀로 옮기는 회전이다. SandBot 쪽은
// R = Rz(90°)·Rz(ψ)·Ry(−θ)·Rx(φ)·C(C = 센서 틀의 OpenCV 축 [−ŷ, −ẑ, x̂], Rz(90°)는 SandBot → SDK 로봇 틀)이고
// Rz(90°)·C = Rx(−90°), Rz(90°)·Ry(α)·Rz(−90°) = Rx(−α), Rx(90°)·Ry(φ)·Rx(−90°) = Rz(φ)이므로 Rz(ψ)·Rx(θ − 90°)·Rz(φ)와
// 같다(spec-4d §1.3). 수평 앞을 보면 (0, −90, 0)이고 SDK 샘플 ConceptAprilTagLocalization의 기본값과 같다.
export function sdkCameraPose(lensInRobot: SimVec3, aim: CameraAim): SdkCameraPose {
  return {
    x: plainZero(-lensInRobot.y * INCH_PER_METER),
    y: plainZero(lensInRobot.x * INCH_PER_METER),
    z: plainZero(lensInRobot.z * INCH_PER_METER),
    yaw: plainZero(aim.yaw * DEGREES_PER_RADIAN),
    pitch: plainZero(aim.pitch * DEGREES_PER_RADIAN - 90),
    roll: plainZero(aim.roll * DEGREES_PER_RADIAN)
  }
}
