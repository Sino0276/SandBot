import { Vector3 } from 'three'
import type { PlaySettings } from '../../../shared/play'
import { NOMINAL_VOLTAGE } from '../../../shared/sim/motorOutputs'
import {
  isValidInertia,
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
  type SimBody,
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
import { floorInertia, subtractMassProps, type MassProps } from '../mass/chassis'
import { componentCotsKey, cotsEntry, wheelCotsKey } from '../mass/cotsTable'
import { DEFAULT_ROBOT_MASS, type MassModel } from '../mass/types'
import { effectiveWheelFriction, wheelSpinInertia } from '../../../shared/sim/wheelData'
import { convexHull } from '../../../shared/sim/wheelLoads'
import type { ConsoleNoticeKey } from './consoleModel'
import { buildWorldJoints, motorComponentParams } from './worldJoints'

// 시뮬레이터의 세계 설명(src/shared/sim/worldSpec.ts)을 씬에서 만든다(INIT 때 고른 로봇, 순수 함수).
// 바퀴는 SceneObject.wheel, 모터·오도메트리는 하드웨어 컴포넌트, 메커니즘 관절은 SceneObject.joint(play/worldJoints.ts)에서
// 온다. 이름은 사이드카 장치 이름(구성 이름을 Java trim, sidecarDeviceName)이다. 위치는 모두 로봇 좌표(X 앞·Y 왼쪽, 원점
// 로봇 중심 바닥)이고, 형상 로딩과 관계없이 씬 문서만으로 정해진다(결정적). 질량(관절 몸체, 섀시 몸체 = 로봇 전체 − 관절
// 몸체, 바퀴 회전 관성)만 넘겨받은 질량 모델을 쓴다.

// Console 경고(console.notices.world*)
export type WorldWarningKey = Extract<ConsoleNoticeKey, `world${string}`>
export type WorldWarning = { key: WorldWarningKey; params: Record<string, string | number> }

// 메카넘 자동 롤러에서 "중심선 위"로 볼 거리(m)와 "앞뒤로 구름"으로 볼 각 오차
const ROLLER_POSITION_EPSILON = 0.005
const ROLLER_ANGLE_EPSILON = 1 * DEG

// CAD가 없을 때의 외곽: 18 in 정사각형(시작 크기 한도)
const DEFAULT_HALF_FOOTPRINT = ROBOT_SIZE / 2
// 높이를 모를 때(CAD 없음, 1 mm 이하)의 충돌 높이: 18 in 임시 로봇과 같다(R102 시작 크기)
const DEFAULT_OUTLINE_HEIGHT = ROBOT_SIZE
const MIN_OUTLINE_HEIGHT = 1e-3

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

// 무부하 최고 굴림 속도(m/s): 모터 출력축 데이터시트 무부하 속도(rad/s, 실제 감속비·덮어쓰기, motorComponentParams) ×
// 전압/12 × 바퀴 반지름 ÷ 외부 감속비(spec-3c §1.8). 세계 설명의 바퀴 모터가 쓰는 값과 같다(엔코더의 SDK maxRPM이 아니다).
// 메카넘도 이상적인 IK에서 앞·옆 최고 속도가 바퀴 표면 속도와 같다(롤러 점성·굴림 저항은 빼지 않은 무부하 값).
export function wheelTopSpeed(
  wheel: WheelSettings,
  motorProps: Record<string, string | number>,
  batteryVoltage: number
): number {
  const { freeSpeed } = motorComponentParams(motorProps)
  return (freeSpeed * (batteryVoltage / NOMINAL_VOLTAGE) * (wheel.diameter / 2)) / wheel.gearRatio
}

// 외곽과 높이: 로봇의 CAD 루트들의 경계 상자(cad.bounds, CAD 좌표) 8꼭짓점을 로봇 좌표로 옮겨, 바닥 사각형(반시계)과
// 꼭짓점 z의 최대값을 낸다. CAD 루트의 피벗은 경계 상자 중심이라 꼭짓점의 로컬 좌표는 꼭짓점 − 중심이다. CAD가 없으면 18 in
// 정사각형, 높이가 1 mm 이하(CAD 없음 포함)면 18 in(임시 로봇과 같은 크기) [가정: 높이는 편집 자세 CAD 최대 z, 없으면 18 in].
// 관절로 올라간 높이는 넣지 않는다(편집 자세). 형상 로딩과 관계없다(cad.bounds는 씬 문서에 있다).
export function robotOutline(
  objects: SceneObjects,
  robotId: string
): { footprint: Vec2[]; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
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
          maxZ = Math.max(maxZ, corner.z)
        }
  }
  if (!(minX < maxX && minY < maxY)) {
    minX = minY = -DEFAULT_HALF_FOOTPRINT
    maxX = maxY = DEFAULT_HALF_FOOTPRINT
  }
  return {
    footprint: [
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: minY }
    ],
    height: maxZ > MIN_OUTLINE_HEIGHT ? maxZ : DEFAULT_OUTLINE_HEIGHT
  }
}

// 외곽(robotOutline의 바닥 사각형)
export function robotFootprint(objects: SceneObjects, robotId: string): Vec2[] {
  return robotOutline(objects, robotId).footprint
}

const xy = (pose: { x: number; y: number }): Vec2 => ({ x: pose.x, y: pose.y })

// 섀시를 모를 때의 몸체(3c): DEFAULT_ROBOT_MASS를 외곽의 경계 상자(높이 0.2 m, 무게중심 높이 0.1 m, 가정)에 고르게 둔 직육면체
export const PLACEHOLDER_CHASSIS_HEIGHT = 0.2
export function placeholderChassisBody(footprint: readonly Vec2[]): SimBody {
  const xs = footprint.map((p) => p.x)
  const ys = footprint.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const a = maxX - minX
  const b = maxY - minY
  const h = PLACEHOLDER_CHASSIS_HEIGHT
  const m = DEFAULT_ROBOT_MASS
  return {
    mass: m,
    centerOfMass: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: h / 2 },
    inertia: [
      (m * (b * b + h * h)) / 12,
      (m * (a * a + h * h)) / 12,
      (m * (a * a + b * b)) / 12,
      0,
      0,
      0
    ]
  }
}

// 섀시 질량 하한(kg): 이보다 작으면 관절 몸체가 로봇 전체 질량을 거의 다 가져간 것(관절 몸체에 덮어쓴 질량이 저울 무게보다
// 큼 등)이라 기본 질량 상자로 대신한다(spec-3c §1.7, 가정: FTC 로봇 섀시는 수 kg이다).
export const MIN_CHASSIS_MASS = 0.1
// 섀시 관성 주관성 값의 하한(kg·m², spec-3c §1.7, 가정): 빼기의 반올림으로 0 근처가 된 축이 기저 질량 행렬을 특이하게
// 만들지 않게 한다(18 in 정사각 13.6 kg 상자의 요 관성 0.48의 약 50만분의 1).
export const MIN_CHASSIS_INERTIA = 1e-6

// 섀시 몸체(3c): 질량 모델의 로봇 전체(RobotMass, 정보 없는 로봇의 외곽 상자 질량과 바퀴 질량 포함)에서 관절 몸체(세계
// 설명의 관절 몸체와 같은 오브젝트 집합, buildWorldJoints의 bodyMasses)를 평행축 정리로 뺀다. 로봇 좌표, 무게중심 기준
// 관성. 질량 모델이 없으면(인스펙터 경로) 경고 없이 기본 상자다. 남은 질량이 MIN_CHASSIS_MASS보다 작거나 관성이 검증을
// 통과하지 못하면 기본 상자와 경고 worldChassisMass다. 질량 모델이 형상을 읽는 중·못 읽은 메시(RobotMass의 pending 경고,
// 덩어리 밖이라 질량이 빠진 것)를 섀시 쪽에 남겼으면(관절 몸체의 것 jointPendingMeshes는 그 관절이 알린다) 경고
// worldChassisMassPending이다: 섀시 질량·무게중심·관성이 읽은 메시만으로 정해져 가속·제동·하중이 실제와 다를 수 있다
// (관절 몸체의 worldJointMassPending과 같은 판단). 질량을 셀 수 있는 형상이 하나도 없어 질량 모델이 로봇 외곽 상자로
// 대신한 로봇(defaultMass: 임시 상자 로봇, 못 찾은 CAD, 아직 아무 메시도 읽지 못함)은 일부가 빠진 것이 아니라 정해진 대체값이라
// 알리지 않는다(Rigidbody 카드가 알린다).
function chassisBody(
  mass: MassModel | null,
  robotId: string,
  jointBodies: readonly (MassProps | null)[],
  jointPendingMeshes: number,
  footprint: readonly Vec2[],
  warnings: WorldWarning[]
): SimBody {
  const robot = mass?.robots[robotId]
  if (!robot) return placeholderChassisBody(footprint)
  const pending = robot.warnings.reduce(
    (count, warning) => (warning.kind === 'pending' ? count + warning.meshes : count),
    0
  )
  const boxed = robot.warnings.some((warning) => warning.kind === 'defaultMass')
  if (!boxed && pending - jointPendingMeshes > 0)
    warnings.push({
      key: 'worldChassisMassPending',
      params: { count: pending - jointPendingMeshes }
    })
  const parts = jointBodies.filter((body): body is MassProps => body !== null)
  const rest = subtractMassProps(
    { mass: robot.mass, centerOfMass: robot.centerOfMass, inertia: robot.inertia },
    parts
  )
  const inertia = rest.mass >= MIN_CHASSIS_MASS && floorInertia(rest.inertia, MIN_CHASSIS_INERTIA)
  const [x, y, z] = rest.centerOfMass
  if (!inertia || !isValidInertia(inertia) || ![x, y, z].every(Number.isFinite)) {
    warnings.push({
      key: 'worldChassisMass',
      params: {
        // g 단위까지(음수는 반올림 잡음이라 0으로 보인다)
        mass: Number.isFinite(rest.mass) ? Math.max(0, Math.round(rest.mass * 1000) / 1000) : 0,
        fallback: DEFAULT_ROBOT_MASS
      }
    })
    return placeholderChassisBody(footprint)
  }
  return { mass: rest.mass, centerOfMass: { x, y, z }, inertia }
}

// 바퀴로 도는 질량(kg, 바퀴 회전 관성용, spec-3c §1.7): 질량 모델의 바퀴 오브젝트 하위 질량에서 그 하위에 붙은 하드웨어
// 컴포넌트(모터·서보·Pinpoint 등)의 데이터시트 질량을 뺀다. 모터 회전자는 전기자 관성(J_rotor·G²)으로 이미 들어가 있고
// 하우징은 돌지 않는다. 바퀴 설정이 표의 제품(goBILDA 메카넘)이고 바퀴 오브젝트에 질량 덮어쓰기가 없으면 그 제품의
// 데이터시트 질량 그대로다(하위가 커서 COTS를 거절한 바퀴 그룹도). 질량 모델이 없거나, 그 오브젝트가 없거나, 빼고 남은
// 것이 0 이하면 null(종류 기본 질량).
export function wheelSpinMass(
  objects: SceneObjects,
  objectId: string,
  wheel: WheelSettings,
  mass: MassModel | null
): number | null {
  const subtree = mass?.objects[objectId]?.mass
  if (subtree === undefined) return null
  const product = wheelCotsKey(wheel)
  const entry = product !== null && objects[objectId].mass?.mass === undefined && cotsEntry(product)
  if (entry) return entry.mass
  let hardware = 0
  for (const id of subtreeIds(objects, objectId)) {
    for (const component of objects[id].components ?? []) {
      const key = componentCotsKey(component)
      hardware += (key !== null && cotsEntry(key)?.mass) || 0
    }
  }
  const rest = subtree - hardware
  return rest > 0 ? rest : null
}

// 바퀴 접점이 로봇 무게를 나눌 수 있는지 볼 때의 받침 다각형 최소 폭(m). 가정: 1 cm보다 좁으면 무게중심 높이 0.1 m에서도
// 0.5 m/s²(g·w/2h)만 가속해도 받침 밖으로 나가 늘 넘어짐 쪽으로 계산된다(같은 자리·일직선 접점과 같다).
export const MIN_SUPPORT_WIDTH = 0.01

// 바퀴 접점(로봇 좌표)이 받침 다각형을 이루지 못하는지: 서로 다른 접점이 셋보다 적거나, 볼록 껍질의 폭(변마다 가장 먼
// 꼭짓점까지 거리의 최솟값)이 MIN_SUPPORT_WIDTH보다 좁다(일직선). 시뮬레이터의 하중 분배(wheelLoads.ts)와 같은 껍질이다.
export function fewWheelContacts(points: readonly Vec2[]): boolean {
  const hull = convexHull(points)
  if (hull.length < 3) return true
  let width = Infinity
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k]
    const b = hull[(k + 1) % hull.length]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!(length > 0)) continue
    let far = 0
    for (const p of hull)
      far = Math.max(far, Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length)
    width = Math.min(width, far)
  }
  return !(width >= MIN_SUPPORT_WIDTH)
}

// 한도를 넘는 목록은 앞의 것만 쓰고 알린다(목록마다 문장이 따로 있다: 무엇이 넘었는지도 번역한다)
type TooManyKey = Extract<WorldWarningKey, `worldTooMany${string}`>
function capped<T>(items: T[], max: number, key: TooManyKey, warnings: WorldWarning[]): T[] {
  if (items.length <= max) return items
  warnings.push({ key, params: { max } })
  return items.slice(0, max)
}

// jointObjectIds: 세계 설명의 관절 순번 → 관절 오브젝트 id(spec이 null이면 빈 목록)
export type WorldSpecResult = {
  spec: WorldSpec | null
  warnings: WorldWarning[]
  jointObjectIds: string[]
  // 관절을 실제로 구동하는 모터 컴포넌트 id(spec이 null이면 빈 목록)
  jointMotorIds: string[]
}

// 세계 설명을 만들어 관절을 구동하는 모터 id를 센다(문서·로봇마다 한 번, 씬 문서는 불변이라 문서로 캐시한다)
const jointMotorCache = new WeakMap<SceneObjects, Map<string, ReadonlySet<string>>>()

// 모터 컴포넌트가 시뮬레이션 세계에서 관절을 구동하는지: 그 로봇의 세계 설명(buildWorldSpec, 질량 없이)이 관절 구동에 쓰는
// 모터인지다. 바퀴를 구동하는 모터, 앞 관절이 이미 쓴 모터, 관절을 둘 수 없는 오브젝트(로봇·바퀴)에 남은 관절, 범위 밖 전달
// 비는 관절을 구동하지 않으므로 아니다. 인스펙터 모터 카드가 관절 값(실제 감속비·출력축 줄·정지 토크·무부하 속도 덮어쓰기)을
// 이것으로 보인다(세계와 같은 규칙이라 카드가 시뮬레이터가 쓰지 않는 값을 보이지 않는다).
export function motorDrivesJoint(
  objects: SceneObjects,
  objectId: string,
  componentId: string
): boolean {
  const robotId = findRobotId(objects, objectId)
  if (!robotId || !robotHasJoints(objects, robotId)) return false
  let byRobot = jointMotorCache.get(objects)
  if (!byRobot) {
    byRobot = new Map()
    jointMotorCache.set(objects, byRobot)
  }
  let ids = byRobot.get(robotId)
  if (!ids) {
    // 세계 설명을 만들지 못하면(실행도 시뮬레이터 없이 한다) 관절을 구동하는 모터가 없다
    try {
      ids = new Set(
        buildWorldSpec(objects, robotId, { batteryVoltage: NOMINAL_VOLTAGE }).jointMotorIds
      )
    } catch {
      ids = new Set()
    }
    byRobot.set(robotId, ids)
  }
  return ids.has(componentId)
}

// 로봇 하위에 관절(SceneObject.joint)이 있는지
export function robotHasJoints(objects: SceneObjects, robotId: string): boolean {
  return !!objects[robotId] && subtreeIds(objects, robotId).some((id) => !!objects[id].joint)
}

// 세계 설명에 질량 모델이 필요한지: 관절(몸체 질량)이나 바퀴(3c 섀시 몸체·바퀴 회전 관성)가 있는 로봇. 질량 모델은 계산이
// 무거우므로(큰 CAD 60–100 ms) 이때만 만든다(INIT, playActions).
export function robotNeedsMassModel(objects: SceneObjects, robotId: string): boolean {
  return (
    !!objects[robotId] &&
    subtreeIds(objects, robotId).some(
      (id) => !!objects[id].joint || (id !== robotId && !!objects[id].wheel)
    )
  )
}

// 고른 로봇의 세계 설명과 Console 경고. 로봇이 없으면 null. 만든 값은 메인과 같은 parseWorldSpec으로 확인하고,
// 받지 않을 값(로봇을 필드에서 아주 멀리 둠 등)이면 null과 worldInvalid 경고를 돌려준다(실행은 시뮬레이터 없이 계속).
// mass는 질량 모델이다: 관절 몸체(MassModel.own), 섀시 몸체(로봇 전체 − 관절 몸체), 바퀴 회전 관성(바퀴 하위 질량). null이면
// 몸체를 대체 질량·기본 상자로, 바퀴를 종류 기본 질량으로 두고 질량 경고를 내지 않는다(play/worldJoints.ts).
export function buildWorldSpec(
  objects: SceneObjects,
  robotId: string,
  settings: Pick<PlaySettings, 'batteryVoltage'>,
  mass: MassModel | null = null
): WorldSpecResult {
  const robot = objects[robotId]
  if (!robot || robot.kind !== 'robot')
    return { spec: null, warnings: [], jointObjectIds: [], jointMotorIds: [] }
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
      directionSign: component.props.direction === 'reverse' ? -1 : 1,
      // 토크·전류·관성은 실제 감속비로 푼 데이터시트 값(감속비 칸 0 = 그 모델의 실제 감속비, SDK gearing이 아님)
      params: motorComponentParams(component.props)
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
      motor: (w.motor && motorDevices.get(w.motor.id)) || null,
      // 바퀴로 도는 질량(wheelSpinMass)의 회전 관성. 모르거나 0이면 종류 기본 질량(wheelData.ts)
      spinInertia: wheelSpinInertia(
        w.wheel.kind,
        w.wheel.diameter / 2,
        wheelSpinMass(objects, w.objectId, w.wheel, mass)
      ),
      // 잠근 바퀴 겉보기 μ(설정 0 = 종류 기본)
      friction: effectiveWheelFriction(w.wheel.kind, w.wheel.friction)
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

  // 관절(3b): 바퀴를 구동하는 모터는 관절에 쓰지 않는다
  const joints = buildWorldJoints({
    objects,
    robotId,
    entries,
    motorDevices,
    wheelMotorIds: new Set(
      resolved.flatMap((w) => (w.motorState === 'ok' && w.motor ? [w.motor.id] : []))
    ),
    wheelObjects: resolved.map((w) => ({ objectId: w.objectId, name: w.name })),
    mass
  })
  warnings.push(...joints.warnings)

  const cappedWheels = capped(wheels, MAX_WORLD_WHEELS, 'worldTooManyWheels', warnings)
  // 바퀴가 있으면 기저가 떠 있고(3c) 하중을 바퀴 접점에 나눈다. 셋보다 적거나 일직선이면 하중이 정해지지 않는다.
  if (cappedWheels.length > 0 && fewWheelContacts(cappedWheels.map((w) => w.position)))
    warnings.push({ key: 'worldFewWheels', params: {} })

  const [x, y] = robot.transform.position
  const { footprint, height } = robotOutline(objects, robotId)
  const spec: WorldSpec = {
    version: WORLD_SPEC_VERSION,
    // 빌더 기본 시즌 'none'. playActions.worldFor가 문서 시즌과 HIVE 설정으로 덮어쓴다(빌더 시그니처는 그대로, spec-4ab §3)
    field: { season: 'none', hiveTipped: [false, false] },
    robot: {
      start: { x, y, yaw: wrapAngle(robot.transform.rotation[2]) },
      footprint,
      height,
      // 바퀴가 없으면 기저가 고정이라 섀시 몸체를 쓰지 않는다(spec-3c §3): 기본 상자로 대신해도 알리지 않는다
      body: chassisBody(
        mass,
        robotId,
        joints.bodyMasses,
        joints.bodyPendingMeshes,
        footprint,
        cappedWheels.length > 0 ? warnings : []
      )
    },
    batteryVoltage: settings.batteryVoltage,
    hubs: lynxModules(robotHardwareSettings(objects, robotId)).map((module) => module.name),
    motors,
    wheels: cappedWheels,
    deadWheels: capped(deadWheels, MAX_WORLD_SENSORS, 'worldTooManyDeadWheels', warnings),
    pinpoints: capped(pinpoints, MAX_WORLD_SENSORS, 'worldTooManyPinpoints', warnings),
    otos: capped(otos, MAX_WORLD_SENSORS, 'worldTooManyOtos', warnings),
    imus: capped(imus, MAX_WORLD_SENSORS, 'worldTooManyImus', warnings),
    joints: joints.joints,
    // 거리·컬러 센서와 잡음은 4c가 채운다
    distanceSensors: [],
    colorSensors: [],
    noise: { enabled: false, seed: 0 }
  }
  const checked = parseWorldSpec(spec)
  if (typeof checked === 'string') {
    warnings.push({ key: 'worldInvalid', params: { detail: checked } })
    return { spec: null, warnings, jointObjectIds: [], jointMotorIds: [] }
  }
  return {
    spec: checked,
    warnings,
    jointObjectIds: joints.objectIds,
    jointMotorIds: joints.motorIds
  }
}
