import { resolveMotorParams } from './actuatorData'
import type { FieldMaterial, FieldSpec, FieldStructure } from './seasons/fieldSpec'
import { resolveSeason } from './seasons/seasons'
import { planarFrame, sensorPose, type SensorPose } from './sensorFrame'
import { DEFAULT_WHEEL_FRICTION, wheelSpinInertia } from './wheelData'
import type { SimBody, SimMotorParams, Vec3, WheelKind, WorldSpec } from './worldSpec'

// 시험용 세계 설명 조각(3c 세계 설명 v3의 필드와 v4 기본 칸). 시뮬레이터·메인·사이드카 통합 시험이 같이 쓴다(제품 코드는 쓰지 않는다).

// 모터 형식·감속비의 데이터시트 값(렌더러 motorComponentParams와 같은 풀이)
export function testMotorParams(modelTag: string, gearbox: number | 'default'): SimMotorParams {
  return resolveMotorParams(modelTag, gearbox)
}

// 기준 섀시: 13.6 kg(3a DEFAULT_ROBOT_MASS)를 18 in 정사각(0.4572 m)·높이 0.2 m 직육면체에 고르게 둠, 무게중심 높이 0.1 m
export const TEST_CHASSIS_MASS = 13.6
export const TEST_CHASSIS_SIDE = 0.4572
export const TEST_CHASSIS_HEIGHT = 0.2
export function testChassis(
  mass = TEST_CHASSIS_MASS,
  side = TEST_CHASSIS_SIDE,
  height = TEST_CHASSIS_HEIGHT
): SimBody {
  const lateral = (mass * (side * side + height * height)) / 12
  return {
    mass,
    centerOfMass: { x: 0, y: 0, z: height / 2 },
    inertia: [lateral, lateral, (mass * 2 * side * side) / 12, 0, 0, 0]
  }
}

// 바퀴의 3c 필드(종류 기본 질량의 회전 관성, 종류 기본 마찰)
export function testWheelPhysics(
  kind: WheelKind,
  radius: number
): { spinInertia: number; friction: number } {
  return {
    spinInertia: wheelSpinInertia(kind, radius, null),
    friction: DEFAULT_WHEEL_FRICTION[kind]
  }
}

// 세계 설명 v4의 새 칸(spec-4ab §5): 시즌 'none'(3c와 바이트까지 같은 공칭 12 ft 근사, 기준 해시가 이것으로 잰다), HIVE 시작
// 상태, 센서 없음, 잡음 끔. 시험 고정값은 이것을 펼쳐 쓰고 robot에 height(18 in)를 넣는다.
export const TEST_ROBOT_HEIGHT = 0.4572
export function worldV4Defaults(): Pick<
  WorldSpec,
  'field' | 'distanceSensors' | 'colorSensors' | 'noise'
> {
  return {
    field: { season: 'none', hiveTipped: [false, false] },
    distanceSensors: [],
    colorSensors: [],
    noise: { enabled: false, seed: 0 }
  }
}

// ---- 거리·컬러 센서(4c) 시험의 필드와 센서 자세(시험 전용). 기준 수치는 spec-4c 부록 A
// (scratchpad p13field/s4c2/sim2.py·tables.py·ctab.py)이고 같은 시험 필드를 쓴다.

export const DEG = Math.PI / 180
export const INCH = 0.0254

// 'none' 시즌의 얕은 복사(checkFieldSpec를 거치지 않는다). 반폭을 10 m로 넓히면 벽 거울이 2.5 m 밖이라 "빈 필드"다
export function testField(change: Partial<FieldSpec> = {}, innerHalf?: number): FieldSpec {
  const none = resolveSeason('none')
  return {
    ...none,
    perimeter:
      innerHalf === undefined ? none.perimeter : { ...none.perimeter, innerHalf: innerHalf },
    ...change
  }
}

// 빈 필드(반폭 10 m)
export const emptyField = (change: Partial<FieldSpec> = {}): FieldSpec => testField(change, 10)

export function material(rho: number, nir = rho): FieldMaterial {
  return { display: '#808080', rgb: [rho, rho, rho], nir }
}

// field carrier sensed 상자
export function sensedBox(
  center: Vec3,
  size: Vec3,
  yaw = 0,
  mat: FieldMaterial = material(0.5),
  flags: Partial<Pick<FieldStructure, 'sensed' | 'occludes' | 'solid' | 'carrier'>> = {}
): FieldStructure {
  return {
    key: 'flower',
    shape: { kind: 'box', center, rotation: { x: 0, y: 0, z: yaw }, size },
    solid: true,
    occludes: true,
    sensed: true,
    material: mat,
    friction: 0.4,
    carrier: 'field',
    ...flags
  }
}

// 로봇 좌표 = 필드 좌표(로봇이 원점, 요 0)에 둔 센서: 원점(하우징 앞면), 조준 요·올려본각
export function aimedPose(origin: Vec3, yaw = 0, pitch = 0): SensorPose {
  return sensorPose(planarFrame({ x: 0, y: 0, yaw: 0 }), {
    body: -1,
    position: origin,
    rotation: { x: 0, y: -pitch, z: yaw }
  })
}
