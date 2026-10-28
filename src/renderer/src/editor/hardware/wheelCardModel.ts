import { Box3, Vector3 } from 'three'
import { robotComponents } from '../../hardware/components'
import type { PlaySettings } from '../../../../shared/play'
import { buildWorldSpec, robotWheels, type WorldWarning } from '../../play/worldSpec'
import { getGeometry } from '../../scene/geometryRegistry'
import {
  findRobotId,
  subtreeIds,
  worldMatrix,
  type HardwareComponent,
  type SceneObject,
  type SceneObjects,
  type WheelKind,
  type WheelSettings
} from '../../scene/model'
import {
  canHaveWheel,
  DEFAULT_WHEEL_DIAMETERS,
  defaultWheel,
  MAX_WHEEL_DIAMETER,
  MIN_WHEEL_DIAMETER,
  WHEEL_KINDS
} from '../../scene/wheel'

// 인스펙터 바퀴 카드·Add Component·로봇 카드 구동계 요약의 보기 계산(그리기와 나눠 시험한다)

// Add Component의 "바퀴"를 고를 수 있는지(이미 있거나 로봇·CAD 루트면 비활성)
export function canAddWheel(object: SceneObject): boolean {
  return canHaveWheel(object) && !object.wheel
}

// 새 바퀴. 이 오브젝트나 하위에 모터가 하나뿐이면 그 모터를 구동 모터로 제안한다(모터와 바퀴를 같은 파트·그룹에 둔 경우).
export function newWheel(objects: SceneObjects, objectId: string): WheelSettings {
  const motors = subtreeIds(objects, objectId).flatMap((id) =>
    (objects[id].components ?? []).filter((component) => component.type === 'motor')
  )
  return { ...defaultWheel(), motor: motors.length === 1 ? motors[0].id : '' }
}

// 종류를 바꿀 때: 지름이 이전 종류의 기본값 그대로면 새 종류의 기본값으로 바꾼다(고친 지름은 그대로)
export function wheelKindPatch(wheel: WheelSettings, kind: WheelKind): Partial<WheelSettings> {
  return wheel.diameter === DEFAULT_WHEEL_DIAMETERS[wheel.kind]
    ? { kind, diameter: DEFAULT_WHEEL_DIAMETERS[kind] }
    : { kind }
}

export type WheelMotorOption = { id: string; name: string; objectName: string }

// 구동 모터로 고를 수 있는 것: 같은 로봇의 motor 컴포넌트(하이어라키 순서). 로봇 밖이면 없다.
export function wheelMotorOptions(objects: SceneObjects, objectId: string): WheelMotorOption[] {
  const robotId = findRobotId(objects, objectId)
  if (!robotId) return []
  return robotComponents(objects, robotId)
    .filter((entry) => entry.component.type === 'motor')
    .map((entry) => ({
      id: entry.component.id,
      name: entry.component.name,
      objectName: objects[entry.objectId].name
    }))
}

// 바퀴 카드 하나의 보기 값
export type WheelCardView = {
  inRobot: boolean
  // 메카넘 롤러(auto를 푼 값), 메카넘이 아니면 null
  rollers: 'flbr' | 'frbl' | null
  rollersAmbiguous: boolean
  motorState: 'none' | 'ok' | 'missing'
  motor: HardwareComponent | null
}

export function wheelCardView(objects: SceneObjects, objectId: string): WheelCardView {
  const robotId = findRobotId(objects, objectId)
  const resolved = robotId
    ? robotWheels(objects, robotId).find((wheel) => wheel.objectId === objectId)
    : undefined
  if (!resolved)
    return {
      inRobot: false,
      rollers: null,
      rollersAmbiguous: false,
      motorState: objects[objectId]?.wheel?.motor ? 'missing' : 'none',
      motor: null
    }
  return {
    inRobot: true,
    rollers: resolved.rollers,
    rollersAmbiguous: resolved.rollersAmbiguous,
    motorState: resolved.motorState,
    motor: resolved.motor
  }
}

// [파트 크기로]: 이 오브젝트(그룹이면 하위) CAD 메시 경계 상자를 이 오브젝트의 축으로 잰 크기에서 둘째로 긴 변.
// 바퀴의 상자는 지름 × 지름 × 폭이라 둘째로 긴 변이 지름이다(허브·롤러가 조금 튀어나와도 가장 긴 변보다 덜 흔들린다).
// 형상이 아직 없으면(불러오는 중) null. 지름 범위로 자른다.
export function suggestWheelDiameter(objects: SceneObjects, objectId: string): number | null {
  if (!objects[objectId]) return null
  const toObject = worldMatrix(objects, objectId).invert()
  const bounds = new Box3()
  for (const id of subtreeIds(objects, objectId)) {
    const visual = objects[id].visual
    if (visual?.type !== 'mesh') continue
    const geometry = getGeometry(visual.geometryId)
    if (!geometry) continue
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) continue
    bounds.union(
      geometry.boundingBox.clone().applyMatrix4(toObject.clone().multiply(worldMatrix(objects, id)))
    )
  }
  if (bounds.isEmpty()) return null
  const size = bounds.getSize(new Vector3())
  const sides = [size.x, size.y, size.z].sort((a, b) => b - a)
  if (!(sides[1] > 0)) return null
  return Math.min(MAX_WHEEL_DIAMETER, Math.max(MIN_WHEEL_DIAMETER, sides[1]))
}

export type DrivetrainSummary = {
  count: number
  // 종류별 수(바퀴가 있는 종류만, mecanum·omni·traction 순서)
  kinds: { kind: WheelKind; count: number }[]
  // INIT 때 Console에 남을 경고와 같은 것(생성 상태 경고 제외)
  warnings: WorldWarning[]
}

// 로봇 카드의 구동계 요약
export function drivetrainSummary(
  objects: SceneObjects,
  robotId: string,
  settings: Pick<PlaySettings, 'batteryVoltage'>
): DrivetrainSummary {
  const wheels = robotWheels(objects, robotId)
  const kinds = WHEEL_KINDS.map((kind) => ({
    kind,
    count: wheels.filter((wheel) => wheel.wheel.kind === kind).length
  })).filter((entry) => entry.count > 0)
  return {
    count: wheels.length,
    kinds,
    warnings: buildWorldSpec(objects, robotId, settings).warnings
  }
}
