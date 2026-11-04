import { Box3 } from 'three'
import { robotComponents } from '../../hardware/components'
import type { PlaySettings } from '../../../../shared/play'
import { GRAVITY } from '../../../../shared/sim/physics'
import {
  DEFAULT_WHEEL_FRICTION,
  effectiveWheelFriction,
  effectiveWheelMass,
  wheelMassClipped,
  wheelSpinInertia
} from '../../../../shared/sim/wheelData'
import { distributeWheelLoads } from '../../../../shared/sim/wheelLoads'
import { MAX_WHEEL_FRICTION, MIN_WHEEL_FRICTION } from '../../../../shared/sim/worldSpec'
import type { MassModel } from '../../mass/types'
import {
  buildWorldSpec,
  robotWheels,
  wheelSpinMass,
  wheelTopSpeed,
  type ResolvedWheel,
  type WorldWarning
} from '../../play/worldSpec'
import { getGeometry } from '../../scene/geometryRegistry'
import {
  findRobotId,
  frameMatrix,
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
import { formatNumber } from '../../units/units'

// 인스펙터 바퀴 카드·Add Component·로봇 카드 구동계 요약의 보기 계산(그리기와 나눠 시험한다)

// Add Component의 "바퀴"를 고를 수 있는지(이미 있거나 로봇·CAD 루트·관절 오브젝트면 비활성. 바퀴는 로봇 몸체에 붙은
// 것으로 계산하므로 관절과 같은 오브젝트에 두지 않는다, spec-3b §2)
export function canAddWheel(object: SceneObject): boolean {
  return canHaveWheel(object) && !object.wheel && !object.joint
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
  // auto라면 고를 형(롤러를 직접 골랐어도, 롤러 칸의 [자동 (…)]), 메카넘이 아니면 null
  autoRollers: 'flbr' | 'frbl' | null
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
      autoRollers: null,
      rollersAmbiguous: false,
      motorState: objects[objectId]?.wheel?.motor ? 'missing' : 'none',
      motor: null
    }
  return {
    inRobot: true,
    rollers: resolved.rollers,
    autoRollers: resolved.autoRollers,
    rollersAmbiguous: resolved.rollersAmbiguous,
    motorState: resolved.motorState,
    motor: resolved.motor
  }
}

// [파트 크기로]: 이 오브젝트(그룹이면 하위) CAD 메시 경계 상자를 로봇 축으로 잰 높이(Z). 바퀴 축은 수평이라 바퀴가
// 어느 쪽을 향해도 높이가 지름이고, 축 방향으로 튀어나온 허브·샤프트에도 흔들리지 않는다(CAD 파일 축으로 잰 상자의
// 변은 X 드라이브처럼 45°로 둔 바퀴에서 지름보다 짧아진다). 로봇 밖이면 필드 축(역시 Z 위).
// 형상이 아직 없으면(불러오는 중) null. 지름 범위로 자른다.
export function suggestWheelDiameter(objects: SceneObjects, objectId: string): number | null {
  if (!objects[objectId]) return null
  const toRobot = frameMatrix(objects, objectId, 'robot').invert()
  const bounds = new Box3()
  for (const id of subtreeIds(objects, objectId)) {
    const visual = objects[id].visual
    if (visual?.type !== 'mesh') continue
    const geometry = getGeometry(visual.geometryId)
    if (!geometry) continue
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) continue
    bounds.union(
      geometry.boundingBox.clone().applyMatrix4(toRobot.clone().multiply(worldMatrix(objects, id)))
    )
  }
  if (bounds.isEmpty()) return null
  const height = bounds.max.z - bounds.min.z
  if (!(height > 0)) return null
  return Math.min(MAX_WHEEL_DIAMETER, Math.max(MIN_WHEEL_DIAMETER, height))
}

// 마찰 칸(겉보기 μ)의 글자. 기어 감속비 칸처럼 소수 둘이다.
export function formatWheelFriction(value: number): string {
  return formatNumber(value, 2)
}

// 마찰 칸 입력 → 바퀴 설정 friction. 0은 종류 기본(비운 것과 같다), 그 밖은 MIN–MAX_WHEEL_FRICTION 안의 수만 받는다
// (범위 밖은 null: 칸이 틀렸다고 보이고 값은 그대로다. sanitizeWheel처럼 조용히 기본으로 돌리지 않는다).
export function parseWheelFriction(text: string): number | null {
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim())) return null
  const value = Number(text.trim())
  if (value === 0) return 0
  return value >= MIN_WHEEL_FRICTION && value <= MAX_WHEEL_FRICTION ? value : null
}

// 바퀴 질량(kg): 세계 설명과 같은 도는 질량(play/worldSpec.ts wheelSpinMass: 하위 질량 − 하위 하드웨어 데이터시트 질량, 표의
// 메카넘은 데이터시트)을 wheelData.ts effectiveWheelMass로 자른 것, 없으면 종류 기본 질량이다(spec-3c §1.7).
// fromModel은 질량 모델의 값을 썼는지, clipped는 그 값이 범위 밖이라 잘렸는지다(카드가 종류 기본·잘린 값을 계산값과 다르게
// 보인다).
export function wheelMass(
  wheel: Pick<WheelSettings, 'kind'>,
  spinMass: number | null | undefined
): { mass: number; fromModel: boolean; clipped: boolean } {
  const fromModel =
    spinMass !== null && spinMass !== undefined && Number.isFinite(spinMass) && spinMass > 0
  return {
    mass: effectiveWheelMass(wheel.kind, spinMass),
    fromModel,
    clipped: wheelMassClipped(spinMass)
  }
}

// 정지한 로봇의 바퀴 하중(N, robotWheels 순서). 질량 모델의 로봇 질량·무게중심(편집 자세)이 바닥에 거는 렌치
// (F_z = m·g, 로봇 원점 둘레 M_x = F_z·y, M_y = −F_z·x)를 시뮬레이터와 같은 분배(wheelLoads.ts)로 나눈다. 로봇 질량을
// 모르면(질량 모델이 없거나 그 로봇의 질량이 0) null이다.
export type StaticWheelLoads = {
  weight: number
  wheels: { objectId: string; load: number }[]
  // 받쳐지지 않은 모멘트(N·m, 무게중심이 바퀴 접점의 볼록 껍질 밖)
  unsupported: number
}

export function robotStaticLoads(
  objects: SceneObjects,
  robotId: string,
  model: MassModel | null,
  wheels: readonly ResolvedWheel[] = robotWheels(objects, robotId)
): StaticWheelLoads | null {
  const robot = model?.robots[robotId]
  if (!robot || !(robot.mass > 0) || wheels.length === 0) return null
  const weight = robot.mass * GRAVITY
  const [x, y] = robot.centerOfMass
  const { loads, unsupported } = distributeWheelLoads(
    wheels.map((w) => w.position),
    weight,
    weight * y,
    -weight * x
  )
  return {
    weight,
    wheels: wheels.map((w, i) => ({ objectId: w.objectId, load: loads[i] })),
    unsupported
  }
}

// 바퀴 카드의 마찰·질량·하중 계산값
export type WheelPhysicsView = {
  // 실행 때 쓰는 겉보기 μ(설정, 0이면 종류 기본)와 종류 기본
  friction: number
  defaultFriction: number
  mass: number
  // 질량 모델의 값인지(아니면 종류 기본 질량 DEFAULT_WHEEL_MASS: 질량을 모름)
  massFromModel: boolean
  // 질량 모델의 값이 범위(MIN·MAX_WHEEL_MASS) 밖이라 잘렸으면 자르기 전 값(kg), 아니면 null
  clippedFrom: number | null
  // kg·m², 바퀴 축(외부 감속 전)
  spinInertia: number
  // 정지 하중(N)과 견인 한계 μ·N(N, 잠근 바퀴를 끄는 힘). 로봇 밖이거나 로봇 질량을 모르면 null
  load: number | null
  tractionLimit: number | null
}

export function wheelPhysicsView(
  objects: SceneObjects,
  objectId: string,
  model: MassModel | null
): WheelPhysicsView | null {
  const wheel = objects[objectId]?.wheel
  if (!wheel) return null
  const friction = effectiveWheelFriction(wheel.kind, wheel.friction)
  const spinMass = wheelSpinMass(objects, objectId, wheel, model)
  const { mass, fromModel, clipped } = wheelMass(wheel, spinMass)
  const robotId = findRobotId(objects, objectId)
  const loads = robotId ? robotStaticLoads(objects, robotId, model) : null
  const load = loads?.wheels.find((entry) => entry.objectId === objectId)?.load ?? null
  return {
    friction,
    defaultFriction: DEFAULT_WHEEL_FRICTION[wheel.kind],
    mass,
    massFromModel: fromModel,
    clippedFrom: clipped ? spinMass : null,
    spinInertia: wheelSpinInertia(wheel.kind, wheel.diameter / 2, mass),
    load,
    tractionLimit: load === null ? null : friction * load
  }
}

export type DrivetrainSummary = {
  count: number
  // 종류별 수(바퀴가 있는 종류만, mecanum·omni·traction 순서)
  kinds: { kind: WheelKind; count: number }[]
  // INIT 때 Console에 남을 경고와 같은 것(생성 상태 경고 제외)
  warnings: WorldWarning[]
  // 견인 한계 가속(m/s²): 모든 바퀴가 미끄러질 때 바닥이 줄 수 있는 앞 방향 힘 Σ μ_i·N_i(구동하는 바퀴만, 구동하지 않는
  // 바퀴는 따라 구르기만 한다) ÷ 질량 = g · Σ μ_i·N_i / Σ N_i. 바퀴가 모두 구동하면 바퀴 μ의 하중 가중 평균 × g다
  // (spec-3c §4 C). 로봇 질량을 모르거나 구동하는 바퀴가 없으면 null.
  tractionAcceleration: number | null
  // 구동하는 바퀴들의 무부하 최고 굴림 속도(m/s, play/worldSpec의 wheelTopSpeed)의 최소·최대. 없으면 null.
  topSpeed: { min: number; max: number } | null
}

// 로봇 카드의 구동계 요약
export function drivetrainSummary(
  objects: SceneObjects,
  robotId: string,
  settings: Pick<PlaySettings, 'batteryVoltage'>,
  model: MassModel | null = null
): DrivetrainSummary {
  const wheels = robotWheels(objects, robotId)
  const kinds = WHEEL_KINDS.map((kind) => ({
    kind,
    count: wheels.filter((wheel) => wheel.wheel.kind === kind).length
  })).filter((entry) => entry.count > 0)
  const driven = wheels.flatMap((w) =>
    w.motorState === 'ok' && w.motor ? [{ wheel: w, motor: w.motor }] : []
  )
  const loads = robotStaticLoads(objects, robotId, model, wheels)
  let tractionAcceleration: number | null = null
  if (loads && driven.length > 0) {
    let force = 0
    wheels.forEach((w, i) => {
      if (w.motorState === 'ok' && w.motor)
        force += effectiveWheelFriction(w.wheel.kind, w.wheel.friction) * loads.wheels[i].load
    })
    tractionAcceleration = (GRAVITY * force) / loads.weight
  }
  const speeds = driven.map(({ wheel, motor }) =>
    wheelTopSpeed(wheel.wheel, motor.props, settings.batteryVoltage)
  )
  return {
    count: wheels.length,
    kinds,
    warnings: buildWorldSpec(objects, robotId, settings).warnings,
    tractionAcceleration,
    topSpeed: speeds.length > 0 ? { min: Math.min(...speeds), max: Math.max(...speeds) } : null
  }
}
