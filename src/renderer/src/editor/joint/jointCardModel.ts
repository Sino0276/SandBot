import { Vector3 } from 'three'
import { MAX_JOINT_MOTORS } from '../../../../shared/sim/worldSpec'
import { robotComponents } from '../../hardware/components'
import type { ObjectMass } from '../../mass/types'
import { jointAxisVector } from '../../scene/jointMotion'
import {
  ancestorIds,
  findRobotId,
  subtreeIds,
  worldMatrix,
  type HardwareComponent,
  type JointDrive,
  type JointSettings,
  type SceneObject,
  type SceneObjects,
  type Vec3
} from '../../scene/model'
import {
  canHaveJoint,
  defaultJoint,
  MAX_JOINT_DAMPING,
  MAX_JOINT_FORCE,
  MAX_JOINT_STIFFNESS,
  MAX_PRISMATIC_LIMIT,
  MAX_REVOLUTE_LIMIT
} from './jointDefaults'
import type { ActuatorRatings } from './jointRatings'

// 인스펙터 관절 카드(Articulation Body)·Add Component의 보기 계산(그리기와 나눠 시험한다). 관절은 시뮬레이터 설정이라
// 생성 코드·구성 XML·하드웨어 검증과 관계없다. 경고는 INIT 때 세계 설명이 Console에 남길 것과 같은 뜻을 카드에서 미리
// 보인다(세계 설명 빌더 play/worldSpec.ts가 같은 규칙으로 거른다).

// 표준 중력 가속도(m/s², ISO 80000-3 표준값, 시뮬레이터 src/shared/sim의 g와 같은 값). 로봇은 바닥 평면에 있어 로봇
// 좌표 −Z 방향이다(spec-3b §1-10).
export const GRAVITY = 9.80665
// 모터 정격 전압(V, 제조사 표의 기준). 정지 토크·무부하 속도는 배터리 전압 ÷ 이 값에 비례한다(DC 모터, 바퀴 최고 속도와 같은 가정).
const RATED_VOLTAGE = 12
// 중력 부하가 이보다 작으면 "부하 없음"으로 보인다(N·m 또는 N, 가정: 표시 자리수 아래)
const NEGLIGIBLE_LOAD = 1e-6

// Add Component의 "관절"을 고를 수 있는지(이미 있거나 로봇·바퀴 오브젝트면 비활성)
export function canAddJoint(object: SceneObject): boolean {
  return canHaveJoint(object) && !object.joint
}

// 새 관절. 회전 관절, 구동 없음(spec §2 기본값)
export function newJoint(): JointSettings {
  return defaultJoint('revolute')
}

export type DriveDeviceKind = 'motor' | 'servo' | 'crServo'

export type DriveOption = { id: string; name: string; objectName: string }

// 구동 장치로 고를 수 있는 것: 같은 로봇의 그 종류 컴포넌트(하이어라키 순서). 로봇 밖이면 없다.
export function driveOptions(
  objects: SceneObjects,
  objectId: string,
  kind: DriveDeviceKind
): DriveOption[] {
  const robotId = findRobotId(objects, objectId)
  if (!robotId) return []
  return robotComponents(objects, robotId)
    .filter((entry) => entry.component.type === kind)
    .map((entry) => ({
      id: entry.component.id,
      name: entry.component.name,
      objectName: objects[entry.objectId].name
    }))
}

// 가장 가까운 관절 상위(자기 제외). 세계 설명의 부모 관절과 같다(관절 몸체 = 하위에서 안쪽 관절의 하위를 뺀 것).
export function parentJointId(objects: SceneObjects, objectId: string): string | null {
  return ancestorIds(objects, objectId).find((id) => objects[id]?.joint !== undefined) ?? null
}

// 다단 슬라이드의 위 단으로 고를 수 있는 것: 이 관절 하위의 직선 관절(문서 순서). 유효한 순서인지는 jointCardView가 본다.
export function stageOptions(
  objects: SceneObjects,
  objectId: string
): { id: string; name: string }[] {
  if (!objects[objectId]) return []
  return subtreeIds(objects, objectId)
    .filter((id) => id !== objectId && objects[id].joint?.type === 'prismatic')
    .map((id) => ({ id, name: objects[id].name }))
}

export type JointWarning =
  | { key: 'noMotor' }
  | { key: 'motorMissing' }
  | { key: 'motorOnWheel'; motor: string }
  | { key: 'motorShared'; motor: string; joint: string }
  | { key: 'servoMissing' }
  | { key: 'servoOnSlide' }
  | { key: 'stageInvalid'; stage: string }
  | { key: 'stageOrphan' }
  | { key: 'noMass' }
  | { key: 'massPending'; count: number }
  | { key: 'cannotHold' }

// 관절 값 단위의 계산값. 회전 관절은 rad·rad/s·N·m, 직선 관절은 m·m/s·N.
export type JointCardView = {
  inRobot: boolean
  // 관절 축의 로봇 좌표 방향(단위 벡터). 로봇 밖이면 필드 좌표.
  robotAxis: Vec3
  // 장치(모터 여럿이면 모두)가 구동하는 관절 좌표의 무부하 최고 속도. 다단이면 맨 위 단(endSpeed)도. 모르면 null.
  maxSpeed: number | null
  endSpeed: number | null
  // 편집 자세(q = 0)에서 중력(+스프링)을 버티는 데 드는 힘·토크의 크기(관절 좌표), 장치의 정지 토크를 관절 좌표로 옮긴
  // 것(모르면 null), 둘의 비(여유, 부하가 없으면 null)
  load: number
  capacity: number | null
  margin: number | null
  // drive가 'stage'일 때 이 단을 rigging에 넣은 아래 단 관절의 id(없으면 null)
  stageOf: string | null
  warnings: JointWarning[]
}

type RobotFrame = { toRobot: (id: string) => { point: (p: Vec3) => Vector3; axis: Vector3 } }

// 로봇 좌표(로봇 밖이면 필드 좌표)로 관절의 앵커·축을 옮긴다. 질량 모델의 무게중심도 같은 좌표다.
function robotFrame(objects: SceneObjects, robotId: string | null): RobotFrame {
  const toRobot = robotId ? worldMatrix(objects, robotId).invert() : null
  return {
    toRobot: (id) => {
      const matrix = worldMatrix(objects, id)
      if (toRobot) matrix.premultiply(toRobot)
      const joint = objects[id].joint!
      return {
        point: (p) => new Vector3(...p).applyMatrix4(matrix),
        axis: jointAxisVector(joint).transformDirection(matrix)
      }
    }
  }
}

// 관절 하나가 q = 0에서 받는 일반화 중력(관절 좌표 + 방향, 회전 N·m·직선 N): 하위 전체(안쪽 관절도 편집 자세)의 질량과
// 무게중심(질량 모델 ObjectMass, 로봇 좌표). 회전은 u·((c − p) × m·g), 직선은 m·(g·u).
function gravityForce(
  objects: SceneObjects,
  frame: RobotFrame,
  id: string,
  masses: Readonly<Record<string, ObjectMass>>
): number {
  const mass = masses[id]
  if (!mass || !(mass.mass > 0)) return 0
  const joint = objects[id].joint!
  const { point, axis } = frame.toRobot(id)
  const weight = new Vector3(0, 0, -GRAVITY * mass.mass)
  if (joint.type === 'prismatic') return weight.dot(axis)
  const lever = new Vector3(...mass.centerOfMass).sub(point(joint.anchor))
  return axis.dot(lever.cross(weight))
}

// q = 0에서 스프링이 관절 좌표 + 방향으로 미는 힘: 정전력은 그 값, 선형은 −k·(0 − 기준 위치) = k·기준 위치
function springForce(joint: JointSettings): number {
  const spring = joint.spring
  if (!spring) return 0
  return spring.kind === 'constantForce' ? spring.force : spring.stiffness * spring.rest
}

// 다단 슬라이드의 유효한 위 단(아래에서 위): 단마다 바로 아래 단(첫 단은 이 관절)이 가장 가까운 관절 상위인 직선 관절이고
// 구동이 'stage'여야 한다(세계 설명 빌더와 같은 규칙). 맞지 않는 단에서 멈춘다.
function validStages(
  objects: SceneObjects,
  objectId: string,
  stages: readonly string[]
): { valid: string[]; invalid: string | null } {
  const valid: string[] = []
  let below = objectId
  for (const id of stages) {
    const stage = objects[id]
    if (
      !stage?.joint ||
      stage.joint.type !== 'prismatic' ||
      stage.joint.drive.kind !== 'stage' ||
      parentJointId(objects, id) !== below ||
      valid.includes(id)
    )
      return { valid, invalid: id }
    valid.push(id)
    below = id
  }
  return { valid, invalid: null }
}

function drivingStages(drive: JointDrive): readonly string[] {
  return drive.kind === 'motor' && drive.rigging.kind !== 'direct' ? drive.rigging.stages : []
}

export function jointCardView(
  objects: SceneObjects,
  objectId: string,
  masses: Readonly<Record<string, ObjectMass>>,
  ratings: ActuatorRatings,
  batteryVoltage: number
): JointCardView | null {
  const object = objects[objectId]
  const joint = object?.joint
  if (!joint) return null
  const robotId = findRobotId(objects, objectId)
  const frame = robotFrame(objects, robotId)
  const robotAxis = frame.toRobot(objectId).axis
  const warnings: JointWarning[] = []
  const entries = robotId ? robotComponents(objects, robotId) : []
  const components = new Map(entries.map((entry) => [entry.component.id, entry.component]))
  const robotObjects = robotId ? subtreeIds(objects, robotId) : [objectId]
  const drive = joint.drive
  const prismatic = joint.type === 'prismatic'
  const voltageScale = batteryVoltage / RATED_VOLTAGE

  // 질량: 하위 전체가 0이면 시뮬레이터는 1 g으로 둔다(spec §1-10). 읽는 중인 메시는 빠진다.
  const mass = masses[objectId]
  if (mass && mass.pendingMeshes > 0)
    warnings.push({ key: 'massPending', count: mass.pendingMeshes })
  else if (!mass || !(mass.mass > 0)) warnings.push({ key: 'noMass' })

  // 관절 좌표(다단이면 첫 단 좌표 z, 연속 리깅은 줄 길이 Σq)의 중력 + 스프링 부하
  const { valid: stages, invalid } = validStages(objects, objectId, drivingStages(drive))
  if (invalid !== null) warnings.push({ key: 'stageInvalid', stage: objects[invalid]?.name ?? '' })
  const stageForces = [objectId, ...stages].map(
    (id) => gravityForce(objects, frame, id, masses) + springForce(objects[id].joint!)
  )
  // 캐스케이드: 단마다 상대 이동이 같아(q_k = z) 단 k의 하위 짐이 모두 z에 걸린다(Σ). 연속: 줄 장력 하나가 모든 단에 같이
  // 걸려 가장 무거운 짐(첫 단이 진 전체)을 버텨야 다 펴진다(max). direct는 그 관절만. method §3.1, data §5.3.
  const continuous = drive.kind === 'motor' && drive.rigging.kind === 'continuous'
  const generalized = continuous
    ? stageForces.reduce((worst, f) => (Math.abs(f) > Math.abs(worst) ? f : worst), 0)
    : stageForces.reduce((sum, f) => sum + f, 0)
  const load = Math.abs(generalized)

  // 장치 → 관절 좌표: 회전은 출력축 rad당 관절 rad = 1/감속비, 직선은 m = 스풀 반지름/감속비(세계 설명 ratio와 같은 뜻)
  const perOutputRad = (gearRatio: number, spoolDiameter: number): number =>
    (prismatic ? spoolDiameter / 2 : 1) / gearRatio
  let maxSpeed: number | null = null
  let capacity: number | null = null
  let stageOf: string | null = null
  switch (drive.kind) {
    case 'motor': {
      if (drive.motors.length === 0) warnings.push({ key: 'noMotor' })
      const wheelMotors = new Set(
        robotObjects.map((id) => objects[id].wheel?.motor).filter((id): id is string => !!id)
      )
      const used: HardwareComponent[] = []
      for (const id of drive.motors.slice(0, MAX_JOINT_MOTORS)) {
        const component = components.get(id)
        if (!component || component.type !== 'motor') {
          warnings.push({ key: 'motorMissing' })
          continue
        }
        if (wheelMotors.has(id)) {
          warnings.push({ key: 'motorOnWheel', motor: component.name })
          continue
        }
        // 앞(문서 순서)의 다른 관절이 이미 쓰는 모터(세계 설명은 먼저 온 관절에 준다)
        const earlier = robotObjects.slice(0, robotObjects.indexOf(objectId)).find((other) => {
          const otherDrive = objects[other].joint?.drive
          return otherDrive?.kind === 'motor' && otherDrive.motors.includes(id)
        })
        if (earlier) {
          warnings.push({ key: 'motorShared', motor: component.name, joint: objects[earlier].name })
          continue
        }
        used.push(component)
      }
      if (used.length === 0) break
      const ratio = perOutputRad(drive.gearRatio, drive.spoolDiameter)
      // 같이 묶은 모터는 한 축을 돌리므로 속도는 첫 모터, 토크는 합이다(세계 설명은 형식이 다르면 첫 모터 값으로 계산)
      const first = ratings.motor(used[0])
      if (first.freeSpeed !== null) maxSpeed = first.freeSpeed * voltageScale * ratio
      const torques = used.map((component) => ratings.motor(component).stallTorque)
      if (torques.every((torque): torque is number => torque !== null))
        capacity = (torques.reduce((sum, torque) => sum + torque, 0) * voltageScale) / ratio
      break
    }
    case 'servo':
    case 'crServo': {
      const component = components.get(drive.servo)
      if (!component || component.type !== drive.kind) {
        warnings.push({ key: 'servoMissing' })
        break
      }
      if (drive.kind === 'servo' && prismatic) {
        warnings.push({ key: 'servoOnSlide' })
        break
      }
      // 서보는 허브의 5 V 서보 전원이라 배터리 전압과 관계없다(가정: 허브 서보 레귤레이터)
      const ratio = perOutputRad(
        drive.gearRatio,
        drive.kind === 'crServo' ? drive.spoolDiameter : 0
      )
      const rating = ratings.servo(component, drive.kind)
      if (rating.freeSpeed !== null) maxSpeed = rating.freeSpeed * ratio
      if (rating.stallTorque !== null) capacity = rating.stallTorque / ratio
      break
    }
    case 'stage': {
      stageOf =
        robotObjects.find((other) => {
          const otherJoint = objects[other].joint
          return (
            otherJoint !== undefined &&
            validStages(objects, other, drivingStages(otherJoint.drive)).valid.includes(objectId)
          )
        }) ?? null
      if (stageOf === null) warnings.push({ key: 'stageOrphan' })
      break
    }
    case 'none':
      break
  }
  // 캐스케이드는 단마다 같은 상대 이동이라 맨 위 단이 (단 수 + 1)배 빠르다. 연속은 한 번에 한 단이 줄 속도로 움직인다.
  const endSpeed =
    maxSpeed !== null && stages.length > 0 ? (continuous ? 1 : stages.length + 1) * maxSpeed : null
  const margin = capacity !== null && load > NEGLIGIBLE_LOAD ? capacity / load : null
  if (margin !== null && margin < 1) warnings.push({ key: 'cannotHold' })
  return {
    inRobot: robotId !== null,
    robotAxis: [robotAxis.x, robotAxis.y, robotAxis.z],
    maxSpeed,
    endSpeed,
    load,
    capacity,
    margin,
    stageOf,
    warnings
  }
}

// 축의 로봇 방향 이름: 로봇 축 하나와 나란하면 그 축(+X 앞, +Y 왼쪽, +Z 위 …), 아니면 null(카드가 벡터로 보인다)
export function robotAxisName(axis: Vec3): `${'+' | '-'}${'x' | 'y' | 'z'}` | null {
  const names = ['x', 'y', 'z'] as const
  for (let i = 0; i < 3; i++)
    // 1e-6: CAD 정렬 회전의 반올림 오차(가정, 0.06° 아래)
    if (Math.abs(Math.abs(axis[i]) - 1) < 1e-6) return `${axis[i] > 0 ? '+' : '-'}${names[i]}`
  return null
}

// 미리보기 슬라이더 범위(관절 값 단위): 한계, 한계 없는 회전 관절은 ±180°
export function previewRange(joint: Pick<JointSettings, 'limits'>): { min: number; max: number } {
  return joint.limits
    ? { min: joint.limits.lower, max: joint.limits.upper }
    : { min: -Math.PI, max: Math.PI }
}

// 한계 칸 하나를 고칠 때: 아래 ≤ 위를 지키도록 반대쪽 값으로 자른다
export function withLimit(
  limits: { lower: number; upper: number },
  edge: 'lower' | 'upper',
  value: number
): { lower: number; upper: number } {
  return edge === 'lower'
    ? { lower: Math.min(value, limits.upper), upper: limits.upper }
    : { lower: limits.lower, upper: Math.max(value, limits.lower) }
}

// 마찰·스프링 칸의 상한(위 jointDefaults의 한도)
const NON_NEGATIVE_MAX = {
  coulomb: MAX_JOINT_FORCE,
  viscous: MAX_JOINT_DAMPING,
  springForce: MAX_JOINT_FORCE,
  stiffness: MAX_JOINT_STIFFNESS
} as const

// 마찰·스프링 칸이 받는 값: 0 이상·한도 이하로 자른다(spec §2. 세계 설명 검증은 음수를 받지 않고, 스토어의 정리는 음수
// 스프링을 통째로 뗀다). 정전력 스프링을 − 방향으로 걸려면 축 부호를 바꾼다(카드 도움말)
export function nonNegativeJointValue(field: keyof typeof NON_NEGATIVE_MAX, value: number): number {
  return Number.isFinite(value) ? Math.min(NON_NEGATIVE_MAX[field], Math.max(0, value)) : 0
}

// 선형 스프링 기준 위치(관절 값 단위): 관절 값 한도(회전 ±4π rad, 직선 ±10 m) 안으로 자른다. 밖이면 스토어의 정리가
// 스프링을 뗀다
export function springRestValue(type: JointSettings['type'], value: number): number {
  const max = type === 'prismatic' ? MAX_PRISMATIC_LIMIT : MAX_REVOLUTE_LIMIT
  return Number.isFinite(value) ? Math.min(max, Math.max(-max, value)) : 0
}
