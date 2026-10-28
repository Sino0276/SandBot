import { Vector3 } from 'three'
import type { PlaySettings } from '../../../shared/play'
import {
  MAX_WORLD_MOTORS,
  MAX_WORLD_SENSORS,
  MAX_WORLD_WHEELS,
  parseWorldSpec,
  WORLD_SPEC_VERSION,
  type MecanumRollers,
  type SimDeadWheelSpec,
  type SimImuSpec,
  type SimMotorSpec,
  type SimOtosSpec,
  type SimPinpointSpec,
  type SimWheelSpec,
  type Vec2,
  type WorldSpec
} from '../../../shared/sim/worldSpec'
import {
  deadWheelTicksPerMeter,
  isComponentType,
  isMotorModel,
  MOTOR_MODEL_TAGS,
  motorGearbox,
  motorOutput,
  pinpointPodTicksPerMm
} from '../hardware/catalog'
import { robotComponents, robotHardwareSettings, type ComponentEntry } from '../hardware/components'
import { lynxModules } from '../hardware/configXml'
import { deadWheelDeviceName } from '../hardware/javaCodegen'
import { normalizeDegrees, robotFramePose } from '../hardware/mounting'
import { sidecarDeviceName } from '../hardware/naming'
import { DEG, ROBOT_SIZE } from '../scene/coordinates'
import {
  findRobotId,
  frameMatrix,
  subtreeIds,
  worldMatrix,
  type HardwareComponent,
  type SceneObjects,
  type WheelSettings
} from '../scene/model'
import { wrapAngle } from '../scene/wheel'
import type { ConsoleNoticeKey } from './consoleModel'

// 운동학 시뮬레이터의 세계 설명(src/shared/sim/worldSpec.ts)을 씬에서 만든다(INIT 때 고른 로봇, 순수 함수).
// 바퀴는 SceneObject.wheel, 모터·오도메트리는 하드웨어 컴포넌트에서 온다. 이름은 사이드카 장치 이름(구성 이름을
// Java trim, sidecarDeviceName)이다. 위치는 모두 로봇 좌표(X 앞·Y 왼쪽, 원점 로봇 중심 바닥)이고, 형상 로딩과
// 관계없이 씬 문서만으로 정해진다(결정적).

// Console 경고(console.notices.world*)
export type WorldWarningKey = Extract<ConsoleNoticeKey, `world${string}`>
export type WorldWarning = { key: WorldWarningKey; params: Record<string, string | number> }

// 메카넘 자동 롤러에서 "중심선 위"로 볼 거리(m)와 "앞뒤로 구름"으로 볼 각 오차
const ROLLER_POSITION_EPSILON = 0.005
const ROLLER_ANGLE_EPSILON = 1 * DEG

// CAD가 없을 때의 외곽: 18 in 정사각형(시작 크기 한도)
const DEFAULT_HALF_FOOTPRINT = ROBOT_SIZE / 2

// 바퀴 오브젝트의 위치(로봇 좌표). 보이는 형상이 있으면 그 피벗(CAD 파트는 경계 상자 중심), 없으면(그룹·형상 없는
// 어셈블리) 하위에서 형상이 있는 오브젝트 피벗들의 경계 상자 중심, 그것도 없으면 자기 피벗. 로봇 밖이면 null.
export function wheelPosition(objects: SceneObjects, objectId: string): Vec2 | null {
  const object = objects[objectId]
  if (!object) return null
  const own = robotFramePose(objects, objectId)
  if (!own || findRobotId(objects, objectId) === null) return null
  if (object.visual) return { x: own.x, y: own.y }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of subtreeIds(objects, objectId)) {
    if (id === objectId || !objects[id].visual) continue
    const pose = robotFramePose(objects, id)
    if (!pose) continue
    minX = Math.min(minX, pose.x)
    maxX = Math.max(maxX, pose.x)
    minY = Math.min(minY, pose.y)
    maxY = Math.max(maxY, pose.y)
  }
  if (minX > maxX) return { x: own.x, y: own.y }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

// 로봇의 바퀴 하나를 푼 것(세계 설명과 인스펙터 바퀴 카드가 같이 쓴다)
export type ResolvedWheel = {
  objectId: string
  name: string
  wheel: WheelSettings
  position: Vec2
  // 메카넘만(auto를 푼 값), 나머지는 null
  rollers: MecanumRollers | null
  // 메카넘만: auto라면 고를 형(롤러를 직접 골랐어도 계산한다, 바퀴 카드의 [자동 (…)]), 나머지는 null
  autoRollers: MecanumRollers | null
  // rollers가 auto에서 정한 값인지
  rollersAuto: boolean
  // auto를 위치로 정하지 못해 flbr로 둠(경고)
  rollersAmbiguous: boolean
  // none: 구동 모터를 고르지 않음, ok: 이 로봇의 모터 컴포넌트, missing: 지웠거나 다른 로봇의 모터(참조는 남는다)
  motorState: 'none' | 'ok' | 'missing'
  motor: HardwareComponent | null
}

// 굴림 방향이 로봇 앞뒤(0°·180°)인지
function rollsForward(angle: number): boolean {
  const folded = Math.abs(wrapAngle(angle))
  return folded <= ROLLER_ANGLE_EPSILON || Math.PI - folded <= ROLLER_ANGLE_EPSILON
}

// 메카넘 롤러 auto: 메카넘 바퀴들의 중심(평균)에 대한 사분면. 앞왼(x>0, y>0)·뒤오른 → flbr, 앞오른·뒤왼 → frbl.
// 중심선 위에 있거나 굴림 방향이 앞뒤가 아니면 정할 수 없어 flbr(경고). 180°로 굴리는 바퀴도 롤러 축이 같아서 같은 형이다.
function autoRollers(
  position: Vec2,
  center: Vec2,
  angle: number
): { rollers: MecanumRollers; ambiguous: boolean } {
  const dx = position.x - center.x
  const dy = position.y - center.y
  if (
    Math.abs(dx) < ROLLER_POSITION_EPSILON ||
    Math.abs(dy) < ROLLER_POSITION_EPSILON ||
    !rollsForward(angle)
  )
    return { rollers: 'flbr', ambiguous: true }
  return { rollers: dx > 0 === dy > 0 ? 'flbr' : 'frbl', ambiguous: false }
}

// 로봇의 모든 바퀴(하이어라키 순서). 모터는 같은 로봇의 motor 컴포넌트만 찾는다.
export function robotWheels(objects: SceneObjects, robotId: string): ResolvedWheel[] {
  if (!objects[robotId]) return []
  const motors = new Map(
    robotComponents(objects, robotId)
      .filter((entry) => entry.component.type === 'motor')
      .map((entry) => [entry.component.id, entry.component])
  )
  const wheels: Omit<
    ResolvedWheel,
    'rollers' | 'autoRollers' | 'rollersAuto' | 'rollersAmbiguous'
  >[] = []
  for (const id of subtreeIds(objects, robotId)) {
    const object = objects[id]
    if (!object.wheel || id === robotId) continue
    const position = wheelPosition(objects, id)
    if (!position) continue
    const motor = object.wheel.motor ? (motors.get(object.wheel.motor) ?? null) : null
    wheels.push({
      objectId: id,
      name: object.name,
      wheel: object.wheel,
      position,
      motorState: object.wheel.motor === '' ? 'none' : motor ? 'ok' : 'missing',
      motor
    })
  }
  const mecanum = wheels.filter((w) => w.wheel.kind === 'mecanum')
  const center: Vec2 = {
    x: mecanum.reduce((sum, w) => sum + w.position.x, 0) / Math.max(1, mecanum.length),
    y: mecanum.reduce((sum, w) => sum + w.position.y, 0) / Math.max(1, mecanum.length)
  }
  return wheels.map((w) => {
    if (w.wheel.kind !== 'mecanum')
      return { ...w, rollers: null, autoRollers: null, rollersAuto: false, rollersAmbiguous: false }
    const auto = autoRollers(w.position, center, w.wheel.angle)
    if (w.wheel.rollers !== 'auto')
      return {
        ...w,
        rollers: w.wheel.rollers,
        autoRollers: auto.rollers,
        rollersAuto: false,
        rollersAmbiguous: false
      }
    return {
      ...w,
      rollers: auto.rollers,
      autoRollers: auto.rollers,
      rollersAuto: true,
      rollersAmbiguous: auto.ambiguous
    }
  })
}

// 무부하 최고 굴림 속도(m/s): 모터 출력축 무부하 RPM × 전압/12 ÷ 외부 감속비 × 바퀴 둘레. 메카넘도 이상적인 IK에서
// 앞·옆 최고 속도가 바퀴 표면 속도와 같다.
export function wheelTopSpeed(
  wheel: WheelSettings,
  motorProps: Record<string, string | number>,
  batteryVoltage: number
): number {
  const { freeRpm } = motorOutput(motorProps)
  return ((freeRpm / 60) * Math.PI * wheel.diameter * (batteryVoltage / 12)) / wheel.gearRatio
}

// 외곽: 로봇의 CAD 루트들의 경계 상자(cad.bounds, CAD 좌표) 8꼭짓점을 로봇 좌표로 옮긴 바닥 사각형(반시계).
// CAD 루트의 피벗은 경계 상자 중심이라 꼭짓점의 로컬 좌표는 꼭짓점 − 중심이다. CAD가 없으면 18 in 정사각형.
export function robotFootprint(objects: SceneObjects, robotId: string): Vec2[] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of subtreeIds(objects, robotId)) {
    const cad = objects[id].cad
    if (!cad) continue
    const toRobot = frameMatrix(objects, id, 'robot').invert().multiply(worldMatrix(objects, id))
    const { min, max } = cad.bounds
    const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2)
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]]) {
          const corner = new Vector3(x - center[0], y - center[1], z - center[2]).applyMatrix4(
            toRobot
          )
          minX = Math.min(minX, corner.x)
          maxX = Math.max(maxX, corner.x)
          minY = Math.min(minY, corner.y)
          maxY = Math.max(maxY, corner.y)
        }
  }
  if (!(minX < maxX && minY < maxY)) {
    minX = minY = -DEFAULT_HALF_FOOTPRINT
    maxX = maxY = DEFAULT_HALF_FOOTPRINT
  }
  return [
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY }
  ]
}

const xy = (pose: { x: number; y: number }): Vec2 => ({ x: pose.x, y: pose.y })

// 한도를 넘는 목록은 앞의 것만 쓰고 알린다(목록마다 문장이 따로 있다: 무엇이 넘었는지도 번역한다)
type TooManyKey = Extract<WorldWarningKey, `worldTooMany${string}`>
function capped<T>(items: T[], max: number, key: TooManyKey, warnings: WorldWarning[]): T[] {
  if (items.length <= max) return items
  warnings.push({ key, params: { max } })
  return items.slice(0, max)
}

export type WorldSpecResult = { spec: WorldSpec | null; warnings: WorldWarning[] }

// 고른 로봇의 세계 설명과 Console 경고. 로봇이 없으면 null. 만든 값은 메인과 같은 parseWorldSpec으로 확인하고,
// 받지 않을 값(로봇을 필드에서 아주 멀리 둠 등)이면 null과 worldInvalid 경고를 돌려준다(실행은 시뮬레이터 없이 계속).
export function buildWorldSpec(
  objects: SceneObjects,
  robotId: string,
  settings: Pick<PlaySettings, 'batteryVoltage'>
): WorldSpecResult {
  const robot = objects[robotId]
  if (!robot || robot.kind !== 'robot') return { spec: null, warnings: [] }
  const warnings: WorldWarning[] = []
  const entries: ComponentEntry[] = robotComponents(objects, robotId).filter((entry) =>
    isComponentType(entry.component.type)
  )
  const ofType = (type: string): ComponentEntry[] =>
    entries.filter((entry) => entry.component.type === type)

  // 모터: 로봇의 모든 motor 컴포넌트(바퀴가 아닌 메커니즘도 엔코더 값을 만든다). 이름이 비었거나 겹치면 쓰지 않는다
  // (검증 오류이기도 하다). 바퀴는 컴포넌트 id → 장치 이름으로 찾는다.
  const motorDevices = new Map<string, string>()
  const motors: SimMotorSpec[] = []
  let motorsCapped = false
  for (const { component } of ofType('motor')) {
    const device = sidecarDeviceName(component.name)
    if (!device || motors.some((motor) => motor.device === device)) {
      warnings.push({ key: 'worldDuplicateMotor', params: { name: component.name } })
      continue
    }
    // 한도를 넘는 모터는 바퀴도 찾지 못하게 장치 이름 표에 넣지 않는다(세계 설명이 모르는 모터를 가리키지 않게)
    if (motors.length === MAX_WORLD_MOTORS) {
      if (!motorsCapped)
        warnings.push({ key: 'worldTooManyMotors', params: { max: MAX_WORLD_MOTORS } })
      motorsCapped = true
      continue
    }
    motorDevices.set(component.id, device)
    const model = component.props.motorModel
    motors.push({
      device,
      // 구성 XML과 같은 태그(configXml deviceTag)
      modelTag: MOTOR_MODEL_TAGS[isMotorModel(model) ? model : 'unspecified'],
      gearbox: motorGearbox(component.props),
      directionSign: component.props.direction === 'reverse' ? -1 : 1
    })
  }

  const resolved = robotWheels(objects, robotId)
  if (resolved.length === 0) warnings.push({ key: 'worldNoWheels', params: {} })
  const wheels: SimWheelSpec[] = resolved.map((w) => {
    if (w.motorState === 'none')
      warnings.push({ key: 'worldWheelNoMotor', params: { name: w.name } })
    if (w.motorState === 'missing')
      warnings.push({ key: 'worldWheelMotorMissing', params: { name: w.name } })
    if (w.rollersAmbiguous)
      warnings.push({ key: 'worldRollersAmbiguous', params: { name: w.name } })
    return {
      position: w.position,
      angle: wrapAngle(w.wheel.angle),
      kind: w.wheel.kind,
      rollers: w.rollers,
      radius: w.wheel.diameter / 2,
      gearRatio: w.wheel.gearRatio,
      motor: (w.motor && motorDevices.get(w.motor.id)) || null
    }
  })

  // 데드휠: 장치 이름은 생성 코드와 같은 규칙(같은 허브·포트 모터가 있으면 그 이름)
  const deadWheels: SimDeadWheelSpec[] = []
  for (const entry of ofType('deadWheel')) {
    const { component } = entry
    const device = sidecarDeviceName(deadWheelDeviceName(entry, entries))
    const pose = robotFramePose(objects, entry.objectId)
    if (!device || !pose) continue
    const shared = entries.find(
      (e) =>
        e.component.type === 'motor' &&
        e.component.hub === component.hub &&
        e.component.port === component.port
    )
    if (shared && shared.component.props.runMode !== 'withoutEncoder')
      warnings.push({
        key: 'worldSharedEncoder',
        params: { deadWheel: component.name, motor: shared.component.name }
      })
    deadWheels.push({
      device,
      position: xy(pose),
      measures: component.props.measures === 'strafe' ? 'strafe' : 'forward',
      reversed: component.props.reversed === 'yes',
      ticksPerMeter: deadWheelTicksPerMeter(component.props)
    })
  }

  // Pinpoint: 포드 파트가 없거나 다른 로봇에 있으면 그 포드는 null(검증 경고 pinpointPodMissing과 같은 판단)
  const podPosition = (id: string | number | undefined): Vec2 | null => {
    if (typeof id !== 'string' || !objects[id] || findRobotId(objects, id) !== robotId) return null
    const pose = robotFramePose(objects, id)
    return pose ? xy(pose) : null
  }
  const pinpoints: SimPinpointSpec[] = []
  for (const { component } of ofType('pinpoint')) {
    const device = sidecarDeviceName(component.name)
    if (!device) continue
    pinpoints.push({
      device,
      xPod: podPosition(component.props.xPod),
      yPod: podPosition(component.props.yPod),
      podTicksPerMm: pinpointPodTicksPerMm(component.props),
      xReversed: component.props.xDirection === 'reversed',
      yReversed: component.props.yDirection === 'reversed'
    })
  }

  const otos: SimOtosSpec[] = []
  for (const { objectId, component } of ofType('otos')) {
    const device = sidecarDeviceName(component.name)
    const pose = robotFramePose(objects, objectId)
    if (!device || !pose) continue
    otos.push({
      device,
      position: xy(pose),
      mountingAngle: normalizeDegrees(Number(component.props.mountingAngle) || 0) * DEG
    })
  }

  const imus: SimImuSpec[] = ofType('imu')
    .map(({ component }) => ({ device: sidecarDeviceName(component.name) }))
    .filter((imu) => imu.device !== '')

  const [x, y] = robot.transform.position
  const spec: WorldSpec = {
    version: WORLD_SPEC_VERSION,
    robot: {
      start: { x, y, yaw: wrapAngle(robot.transform.rotation[2]) },
      footprint: robotFootprint(objects, robotId)
    },
    batteryVoltage: settings.batteryVoltage,
    hubs: lynxModules(robotHardwareSettings(objects, robotId)).map((module) => module.name),
    motors,
    wheels: capped(wheels, MAX_WORLD_WHEELS, 'worldTooManyWheels', warnings),
    deadWheels: capped(deadWheels, MAX_WORLD_SENSORS, 'worldTooManyDeadWheels', warnings),
    pinpoints: capped(pinpoints, MAX_WORLD_SENSORS, 'worldTooManyPinpoints', warnings),
    otos: capped(otos, MAX_WORLD_SENSORS, 'worldTooManyOtos', warnings),
    imus: capped(imus, MAX_WORLD_SENSORS, 'worldTooManyImus', warnings)
  }
  const checked = parseWorldSpec(spec)
  if (typeof checked === 'string') {
    warnings.push({ key: 'worldInvalid', params: { detail: checked } })
    return { spec: null, warnings }
  }
  return { spec: checked, warnings }
}
