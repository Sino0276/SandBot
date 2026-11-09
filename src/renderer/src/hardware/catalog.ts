// 하드웨어 컴포넌트 카탈로그. XML 태그·Java 클래스·I2C 주소는 FTC SDK 12.0 소스(10.3·11.1과 동일)에서 확인한 값만 쓴다.
// 구성 XML 태그는 대소문자를 구분하고, 틀리면 SDK가 오류 없이 장치를 버리므로 추측한 값을 넣지 않는다.

import {
  DEFAULT_SERVO_MODEL,
  MAX_FREE_SPEED_OVERRIDE_RPM,
  MAX_STALL_TORQUE_OVERRIDE,
  MIN_FREE_SPEED_OVERRIDE_RPM,
  MIN_STALL_TORQUE_OVERRIDE,
  SERVO_MODEL_KEYS
} from '../../../shared/sim/actuatorData'
import { motorType } from '../../../shared/sim/motorTypes'
import type { JointType } from '../scene/model'

// 장치가 차지하는 자리
// - motor/servo/digital/analog: 허브의 해당 포트(번호 범위는 PORT_RANGES)
// - i2c: 허브의 I2C 버스(0–3). 같은 버스에 주소가 다른 장치 여럿을 달 수 있다.
// - encoder: 모터 포트 옆의 엔코더 단자(데드휠). 같은 번호의 모터와 장치 이름을 나눠 쓴다.
// - usb: Control Hub USB(웹캠, Limelight). 허브·포트를 쓰지 않는다.
export type PortKind = 'motor' | 'servo' | 'digital' | 'analog' | 'i2c' | 'encoder' | 'usb'

export const PORT_RANGES: Record<Exclude<PortKind, 'usb'>, number> = {
  motor: 4,
  servo: 6,
  digital: 8,
  analog: 4,
  i2c: 4,
  encoder: 4
}

// 허브 내장 IMU는 I2C 버스 0에 있다
export const EMBEDDED_IMU_BUS = 0
export const CONTROL_HUB_ADDRESS = 173
export const DEFAULT_EXPANSION_HUB_ADDRESS = 2

// object 속성이 고를 수 있는 오브젝트의 종류
export type ObjectPick = 'any' | 'joint'

// 속성 공통 표시 정보
type PropertyMeta = {
  // 다른 enum 속성이 이 값들 중 하나일 때만 인스펙터에 보인다(값은 늘 저장한다)
  visibleWhen?: { key: string; values: readonly string[] }
  // 다른 object 속성(key)이 관절이 있는 오브젝트를 가리킬 때만 보인다. types가 있으면 그 관절 형식일 때만(값은 늘 저장한다).
  visibleWhenJoint?: { key: string; types?: readonly JointType[] }
  // 칸 설명(hardware.propHints.<key>, 인스펙터 행의 도움말). labels.test.ts가 ko·en에 있는지 확인한다.
  hint?: true
  // 시뮬레이터 전용(시뮬레이터의 세계 설명만 읽는다). 생성 Java·구성 XML에 쓰지 않으므로 바꿔도 생성 파일이
  // 바이트 단위로 같아야 한다(generatedOutput.test.ts가 확인).
  simulation?: true
}

export type PropertyDef = PropertyMeta &
  (
    | { key: string; kind: 'enum'; options: readonly string[]; default: string }
    | {
        key: string
        kind: 'number'
        default: number
        min?: number
        max?: number
        // 표시 소수 자릿수
        digits: number
        // 이보다 작은 값을 넣으면 0(기본)으로 저장한다(0이 '기본값'인 덮어쓰기 칸)
        zeroBelow?: number
      }
    // 길이(내부 미터). 인스펙터는 표시 단위(units/units.ts)로 보이고, 입력칸은 단위를 붙인 값도 받는다.
    | { key: string; kind: 'length'; default: number; min: number; max: number }
    // 각도(내부 라디안). 인스펙터는 도(°)로 보이고, 입력칸은 °·rad를 붙인 값도 받는다.
    // wrap이면 인스펙터 칸이 확정 값을 (−π, π]로 감고(Unity 회전 칸처럼 자르지 않음, −180°는 180°), 아니면 [min, max]로
    // 자른다. 파일에서 읽는 값은 둘 다 범위 밖이면 기본값이다(projectFile.ts parseProps).
    | { key: string; kind: 'angle'; default: number; min: number; max: number; wrap?: true }
    | { key: string; kind: 'text'; default: string }
    // 다른 씬 오브젝트(예: 오도메트리 포드 파트)를 가리킨다. 값은 오브젝트 id, 비어 있으면 ''. pick은 고를 수 있는 것:
    // 'any'(기본) 같은 로봇의 오브젝트, 'joint' 같은 로봇의 관절 오브젝트(리밋 스위치)
    | { key: string; kind: 'object'; default: ''; pick?: ObjectPick }
  )

export type ComponentCategory = 'actuator' | 'sensor' | 'imu' | 'odometry' | 'vision' | 'other'

export type ComponentTypeDef = {
  category: ComponentCategory
  portKind: PortKind
  // 새로 붙일 때의 구성 이름(같은 이름이 있으면 번호를 붙인다)
  defaultName: string
  // 생성 코드의 필드 타입(단순 이름)과 import
  javaType: string
  imports: string[]
  // 기본 7비트 I2C 주소. 같은 버스에서 주소가 겹치면 충돌이다.
  i2cAddress?: number
  properties: PropertyDef[]
}

const DIRECTION = {
  key: 'direction',
  kind: 'enum',
  options: ['forward', 'reverse'],
  default: 'forward'
} as const

// 모터 종류 → 구성 XML 태그. goBILDA 5202/5203/5204는 태그 하나를 같이 쓴다.
export const MOTOR_MODEL_TAGS = {
  goBilda5202: 'goBILDA5202SeriesMotor',
  goBilda5201: 'goBILDA5201SeriesMotor',
  revHdHex20: 'RevRobotics20HDHexMotor',
  revHdHex40: 'RevRobotics40HDHexMotor',
  revUltraPlanetary: 'RevRoboticsUltraplanetaryHDHexMotor',
  revCoreHex: 'RevRoboticsCoreHexMotor',
  neverest20: 'NeveRest20Gearmotor',
  neverest40: 'NeveRest40Gearmotor',
  neverest60: 'NeveRest60Gearmotor',
  tetrix: 'TetrixMotor',
  matrix12v: 'Matrix12vMotor',
  studicaMaverick: 'StudicaMaverick',
  unspecified: 'Motor'
} as const

export type MotorModel = keyof typeof MOTOR_MODEL_TAGS

// 모터 종류의 SDK 형식 값(@MotorType의 ticksPerRev·gearing·maxRPM). 시뮬레이터와 같은 표(src/shared/sim/motorTypes.ts,
// 사이드카 MotorConfigurationType과 대조함)에서 구성 태그로 꺼낸다.
// SDK 형식은 계열당 감속비 하나만 안다(goBILDA 5202 계열은 99.5:1, ticksPerRev는 그 감속비의 출력축 틱).
export const MOTOR_MODEL_SDK = Object.fromEntries(
  (Object.keys(MOTOR_MODEL_TAGS) as MotorModel[]).map((model) => {
    const { ticksPerRev, gearing, maxRPM } = motorType(MOTOR_MODEL_TAGS[model])
    return [model, { ticksPerRev, gearing, maxRPM }]
  })
) as Record<MotorModel, { ticksPerRev: number; gearing: number; maxRPM: number }>

export function isMotorModel(value: unknown): value is MotorModel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOTOR_MODEL_TAGS, value)
}

// 모터 gearbox 속성의 값 0은 "모델 기본"(그 모델의 SDK gearing)이다. 기본값이 모델마다 다른데 propertyDefaults는
// 모델을 모르므로 0을 기본으로 두고, 쓰는 곳(세계 설명, 인스펙터 계산값)이 이 함수로 실제 감속비를 구한다.
// 세계 설명의 하한(0.01)보다 작은 값도 모델 기본으로 본다.
export const MIN_GEARBOX = 0.01
export const MAX_GEARBOX = 10000

export function motorGearbox(props: Record<string, string | number>): number {
  const value = Number(props.gearbox)
  const model = isMotorModel(props.motorModel) ? props.motorModel : 'unspecified'
  return Number.isFinite(value) && value >= MIN_GEARBOX && value <= MAX_GEARBOX
    ? value
    : MOTOR_MODEL_SDK[model].gearing
}

// 무부하 출력축 RPM(12 V)과 출력축 1회전 틱. SDK 형식의 값을 실제 감속비(gearbox)로 바꾼다.
export function motorOutput(props: Record<string, string | number>): {
  gearbox: number
  freeRpm: number
  ticksPerRev: number
} {
  const model = isMotorModel(props.motorModel) ? props.motorModel : 'unspecified'
  const sdk = MOTOR_MODEL_SDK[model]
  const gearbox = motorGearbox(props)
  return {
    gearbox,
    freeRpm: (sdk.maxRPM * sdk.gearing) / gearbox,
    ticksPerRev: (sdk.ticksPerRev / sdk.gearing) * gearbox
  }
}

// 오도메트리 포드의 해상도. goBILDA 포드는 SDK GoBildaPinpointDriver의 값(틱/mm, 32 mm·48 mm 바퀴에 2000 CPR),
// REV Through Bore는 8192 CPR에 바퀴 지름을 넣는다.
export const GOBILDA_POD_TICKS_PER_MM = { fourBar: 19.89436789, swingarm: 13.26291192 } as const
export const REV_THROUGH_BORE_CPR = 8192
export const DEAD_WHEEL_POD_TYPES = ['fourBar', 'swingarm', 'revThroughBore', 'custom'] as const
// 직접 넣는 포드 바퀴 지름(m)과 CPR의 기본값·범위
const POD_DIAMETER = { default: 0.035, min: 0.005, max: 0.2 } as const
const POD_CPR = { default: REV_THROUGH_BORE_CPR, min: 1, max: 1000000 } as const

// 리밋 스위치가 눌리는 거리·각도의 상한(m·rad). 세계 설명이 받는 스위치 within 상한(1)과 같다.
export const MAX_LIMIT_WITHIN = 1

// 서보·CR 서보의 모델(시뮬레이터 전용, 관절 구동의 토크·속도·각 범위 표 src/shared/sim/actuatorData.ts와 질량 표)
const SERVO_MODEL = {
  key: 'servoModel',
  kind: 'enum',
  options: SERVO_MODEL_KEYS,
  default: DEFAULT_SERVO_MODEL,
  simulation: true
} as const

// 리밋 스위치(touch·digital, 시뮬레이터 전용): 같은 로봇의 관절 오브젝트(limitJoint)의 한계(limitAt) 근처에서 눌린다
// (touch pressed true, digital state false). 눌리는 범위는 직선 관절이면 limitDistance(길이, 표시 단위), 회전 관절이면
// limitAngle(각도, °)이고 0이면 기본값(scene/joint.ts DEFAULT_LIMIT_WITHIN: 2 mm·1°)이다. 인스펙터는 연결한 관절의
// 형식에 맞는 칸만 보인다.
const LIMIT_SWITCH = [
  { key: 'limitJoint', kind: 'object', default: '', pick: 'joint', simulation: true },
  {
    key: 'limitAt',
    kind: 'enum',
    options: ['lower', 'upper'],
    default: 'lower',
    visibleWhenJoint: { key: 'limitJoint' },
    simulation: true
  },
  {
    key: 'limitDistance',
    kind: 'length',
    default: 0,
    min: 0,
    max: MAX_LIMIT_WITHIN,
    visibleWhenJoint: { key: 'limitJoint', types: ['prismatic'] },
    hint: true,
    simulation: true
  },
  {
    key: 'limitAngle',
    kind: 'angle',
    default: 0,
    min: 0,
    max: MAX_LIMIT_WITHIN,
    visibleWhenJoint: { key: 'limitJoint', types: ['revolute'] },
    hint: true,
    simulation: true
  }
] as const

// 거리·컬러 센서의 조준(시뮬레이터 전용, 4c). 로봇 좌표 기준이고 CAD 파트 회전과 관계없다(OTOS mountingAngle과 같은
// 원칙). aimYaw는 로봇 +X(앞)에서 반시계 +(위에서 볼 때), aimPitch는 올려본각(위 +)이다. 센서 틀 회전은 ZYX
// (0, −aimPitch, aimYaw)(hardware/mounting.ts aimRotation). 롤은 없다(두 센서는 축 대칭 원뿔이라 값에 영향이 없다).
// 범위: 요는 한 바퀴 [−π, π], 높이각은 위·아래 끝 [−π/2, π/2](synthesis §9.8).
export const AIM_YAW = {
  key: 'aimYaw',
  kind: 'angle',
  default: 0,
  min: -Math.PI,
  max: Math.PI,
  wrap: true,
  hint: true,
  simulation: true
} as const
// 거리 센서는 기본으로 앞(수평)을 본다
export const AIM_PITCH_LEVEL = {
  key: 'aimPitch',
  kind: 'angle',
  default: 0,
  min: -Math.PI / 2,
  max: Math.PI / 2,
  hint: true,
  simulation: true
} as const
// 컬러 센서는 기본으로 아래(바닥, −90°)를 본다(synthesis §4.1)
export const AIM_PITCH_DOWN = { ...AIM_PITCH_LEVEL, default: -Math.PI / 2 } as const

// 인스펙터 각도 칸이 확정한 값(rad)을 저장 값으로 바꾼다. wrap이면 (−π, π]로 감고(seasons/symmetry.ts wrapPi와 같은
// 규칙이되 여러 바퀴도 감는다: 270° → −90°, −180° → 180°, 720° → 0°), 아니면 [min, max]로 자른다. 감은 값도 반올림
// 오차로 범위를 넘지 않게 마지막에 자르고, −0은 0으로 둔다.
export function angleInputValue(
  property: { min: number; max: number; wrap?: true },
  radians: number
): number {
  let value = radians
  if (property.wrap) value = radians - 2 * Math.PI * Math.ceil((radians - Math.PI) / (2 * Math.PI))
  value = Math.min(property.max, Math.max(property.min, value))
  return value === 0 ? 0 : value
}

export const HUB_DIRECTIONS = ['up', 'down', 'forward', 'backward', 'left', 'right'] as const

export const COMPONENT_TYPES = {
  motor: {
    category: 'actuator',
    portKind: 'motor',
    defaultName: 'motor',
    javaType: 'DcMotorEx',
    imports: [
      'com.qualcomm.robotcore.hardware.DcMotor',
      'com.qualcomm.robotcore.hardware.DcMotorEx',
      'com.qualcomm.robotcore.hardware.DcMotorSimple'
    ],
    properties: [
      {
        key: 'motorModel',
        kind: 'enum',
        options: Object.keys(MOTOR_MODEL_TAGS),
        default: 'goBilda5202'
      },
      DIRECTION,
      {
        key: 'runMode',
        kind: 'enum',
        options: ['withoutEncoder', 'usingEncoder', 'resetThenUsingEncoder'],
        default: 'withoutEncoder'
      },
      { key: 'zeroPowerBehavior', kind: 'enum', options: ['brake', 'float'], default: 'brake' },
      // 실제 기어박스 감속비(goBILDA 312 RPM은 19.2). 0은 모델 기본(motorGearbox). 시뮬레이터 전용.
      {
        key: 'gearbox',
        kind: 'number',
        default: 0,
        min: 0,
        max: MAX_GEARBOX,
        digits: 2,
        simulation: true
      },
      // 기어모터 값 덮어쓰기: 12 V 출력축 정지 토크(N·m)와 무부하 속도(rpm). 0은 데이터시트
      // (src/shared/sim/actuatorData.ts). 받는 하한보다 작은 값은 0으로 저장한다(표시 자릿수 한 칸). 시뮬레이터 전용.
      // 3c부터 모든 모터(바퀴·관절·어디에도 붙지 않은 모터)가 데이터시트 기어모터로 돌므로 모든 모터 카드에 보인다.
      {
        key: 'stallTorque',
        kind: 'number',
        default: 0,
        min: 0,
        max: MAX_STALL_TORQUE_OVERRIDE,
        digits: 3,
        zeroBelow: MIN_STALL_TORQUE_OVERRIDE,
        hint: true,
        simulation: true
      },
      {
        key: 'freeSpeed',
        kind: 'number',
        default: 0,
        min: 0,
        max: MAX_FREE_SPEED_OVERRIDE_RPM,
        digits: 0,
        zeroBelow: MIN_FREE_SPEED_OVERRIDE_RPM,
        hint: true,
        simulation: true
      }
    ]
  },
  servo: {
    category: 'actuator',
    portKind: 'servo',
    defaultName: 'servo',
    javaType: 'Servo',
    imports: ['com.qualcomm.robotcore.hardware.Servo'],
    properties: [
      // standard: 600–2400 µs(Servo), fullRange: 500–2500 µs(ServoFullRange)
      { key: 'pulseRange', kind: 'enum', options: ['standard', 'fullRange'], default: 'standard' },
      DIRECTION,
      { key: 'scaleMin', kind: 'number', default: 0, min: 0, max: 1, digits: 2 },
      { key: 'scaleMax', kind: 'number', default: 1, min: 0, max: 1, digits: 2 },
      SERVO_MODEL
    ]
  },
  crServo: {
    category: 'actuator',
    portKind: 'servo',
    defaultName: 'crServo',
    javaType: 'CRServo',
    imports: [
      'com.qualcomm.robotcore.hardware.CRServo',
      'com.qualcomm.robotcore.hardware.DcMotorSimple'
    ],
    properties: [DIRECTION, SERVO_MODEL]
  },
  sparkMini: {
    category: 'actuator',
    portKind: 'servo',
    defaultName: 'sparkMini',
    javaType: 'DcMotorSimple',
    imports: ['com.qualcomm.robotcore.hardware.DcMotorSimple'],
    properties: [DIRECTION]
  },
  imu: {
    category: 'imu',
    portKind: 'i2c',
    defaultName: 'imu',
    javaType: 'IMU',
    imports: [
      'com.qualcomm.robotcore.hardware.IMU',
      'com.qualcomm.hardware.rev.RevHubOrientationOnRobot'
    ],
    i2cAddress: 0x28,
    properties: [
      // BHI260AP: 2022년 9월 이후 Control Hub, BNO055: 그 전 Control Hub·Expansion Hub
      { key: 'chip', kind: 'enum', options: ['bhi260ap', 'bno055'], default: 'bhi260ap' },
      // 허브 로고와 USB 포트가 로봇의 어느 쪽을 향하는지(RevHubOrientationOnRobot)
      { key: 'logoFacing', kind: 'enum', options: HUB_DIRECTIONS, default: 'up' },
      { key: 'usbFacing', kind: 'enum', options: HUB_DIRECTIONS, default: 'forward' }
    ]
  },
  distanceSensor: {
    category: 'sensor',
    portKind: 'i2c',
    defaultName: 'distance',
    javaType: 'DistanceSensor',
    imports: ['com.qualcomm.robotcore.hardware.DistanceSensor'],
    i2cAddress: 0x29,
    properties: [AIM_YAW, AIM_PITCH_LEVEL]
  },
  colorSensor: {
    category: 'sensor',
    portKind: 'i2c',
    defaultName: 'color',
    javaType: 'NormalizedColorSensor',
    imports: ['com.qualcomm.robotcore.hardware.NormalizedColorSensor'],
    i2cAddress: 0x52,
    properties: [
      { key: 'gain', kind: 'number', default: 2, min: 1, max: 100, digits: 1 },
      AIM_YAW,
      AIM_PITCH_DOWN
    ]
  },
  touchSensor: {
    category: 'sensor',
    portKind: 'digital',
    defaultName: 'touch',
    javaType: 'TouchSensor',
    imports: ['com.qualcomm.robotcore.hardware.TouchSensor'],
    properties: [...LIMIT_SWITCH]
  },
  digitalDevice: {
    category: 'sensor',
    portKind: 'digital',
    defaultName: 'digital',
    javaType: 'DigitalChannel',
    imports: ['com.qualcomm.robotcore.hardware.DigitalChannel'],
    properties: [
      { key: 'mode', kind: 'enum', options: ['input', 'output'], default: 'input' },
      ...LIMIT_SWITCH
    ]
  },
  analogInput: {
    category: 'sensor',
    portKind: 'analog',
    defaultName: 'analog',
    javaType: 'AnalogInput',
    imports: ['com.qualcomm.robotcore.hardware.AnalogInput'],
    properties: []
  },
  led: {
    category: 'other',
    portKind: 'digital',
    defaultName: 'led',
    javaType: 'LED',
    imports: ['com.qualcomm.robotcore.hardware.LED'],
    properties: []
  },
  blinkin: {
    category: 'other',
    portKind: 'servo',
    defaultName: 'blinkin',
    javaType: 'RevBlinkinLedDriver',
    imports: ['com.qualcomm.hardware.rev.RevBlinkinLedDriver'],
    properties: []
  },
  webcam: {
    category: 'vision',
    portKind: 'usb',
    defaultName: 'Webcam 1',
    javaType: 'WebcamName',
    imports: ['org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName'],
    // 구성 XML의 Webcam은 실제 카메라의 USB 시리얼이 있어야 연결된다(DS의 Configure Robot 스캔으로 확인)
    properties: [{ key: 'serialNumber', kind: 'text', default: '' }]
  },
  limelight: {
    category: 'vision',
    portKind: 'usb',
    defaultName: 'limelight',
    javaType: 'Limelight3A',
    imports: ['com.qualcomm.hardware.limelightvision.Limelight3A'],
    // DS가 스캔한 시리얼: EthernetOverUsb:<인터페이스>:<IP>
    properties: [{ key: 'serialNumber', kind: 'text', default: '' }]
  },
  huskyLens: {
    category: 'vision',
    portKind: 'i2c',
    defaultName: 'huskyLens',
    javaType: 'HuskyLens',
    imports: ['com.qualcomm.hardware.dfrobot.HuskyLens'],
    i2cAddress: 0x32,
    properties: []
  },
  pinpoint: {
    category: 'odometry',
    portKind: 'i2c',
    defaultName: 'pinpoint',
    javaType: 'GoBildaPinpointDriver',
    imports: [
      'com.qualcomm.hardware.gobilda.GoBildaPinpointDriver',
      'org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit'
    ],
    i2cAddress: 0x31,
    properties: [
      { key: 'podType', kind: 'enum', options: ['fourBar', 'swingarm'], default: 'fourBar' },
      // 앞뒤 이동을 재는 X 포드와 좌우 이동을 재는 Y 포드가 달린 파트. 오프셋을 CAD 위치에서 계산한다.
      { key: 'xPod', kind: 'object', default: '' },
      { key: 'yPod', kind: 'object', default: '' },
      { key: 'xDirection', kind: 'enum', options: ['forward', 'reversed'], default: 'forward' },
      { key: 'yDirection', kind: 'enum', options: ['forward', 'reversed'], default: 'forward' }
    ]
  },
  otos: {
    category: 'odometry',
    portKind: 'i2c',
    defaultName: 'otos',
    javaType: 'SparkFunOTOS',
    imports: ['com.qualcomm.hardware.sparkfun.SparkFunOTOS'],
    i2cAddress: 0x17,
    properties: [
      // 센서가 로봇 앞 방향에서 돌아간 각도(반시계 +, 도). 오프셋 위치는 이 컴포넌트가 붙은 파트의 위치다.
      { key: 'mountingAngle', kind: 'number', default: 0, min: -180, max: 180, digits: 1 },
      { key: 'linearScalar', kind: 'number', default: 1, min: 0.872, max: 1.127, digits: 3 },
      { key: 'angularScalar', kind: 'number', default: 1, min: 0.872, max: 1.127, digits: 3 }
    ]
  },
  octoQuad: {
    category: 'odometry',
    portKind: 'i2c',
    defaultName: 'octoquad',
    javaType: 'OctoQuad',
    imports: ['com.qualcomm.hardware.digitalchickenlabs.OctoQuad'],
    i2cAddress: 0x30,
    properties: []
  },
  deadWheel: {
    category: 'odometry',
    portKind: 'encoder',
    defaultName: 'deadWheel',
    javaType: 'DcMotorEx',
    imports: ['com.qualcomm.robotcore.hardware.DcMotorEx'],
    properties: [
      // 이 포드가 재는 방향(로봇 기준). 위치는 이 컴포넌트가 붙은 파트의 위치다.
      { key: 'measures', kind: 'enum', options: ['forward', 'strafe'], default: 'forward' },
      { key: 'reversed', kind: 'enum', options: ['no', 'yes'], default: 'no' },
      // 포드 해상도(시뮬레이터 전용, deadWheelTicksPerMeter). 지름은 REV Through Bore·직접 입력일 때, CPR은 직접 입력일 때만 쓴다.
      {
        key: 'podType',
        kind: 'enum',
        options: DEAD_WHEEL_POD_TYPES,
        default: 'fourBar',
        simulation: true
      },
      {
        key: 'podDiameter',
        kind: 'length',
        ...POD_DIAMETER,
        visibleWhen: { key: 'podType', values: ['revThroughBore', 'custom'] },
        simulation: true
      },
      {
        key: 'podCpr',
        kind: 'number',
        ...POD_CPR,
        digits: 0,
        visibleWhen: { key: 'podType', values: ['custom'] },
        simulation: true
      }
    ]
  }
} as const satisfies Record<string, ComponentTypeDef>

export type ComponentType = keyof typeof COMPONENT_TYPES

export const COMPONENT_TYPE_KEYS = Object.keys(COMPONENT_TYPES) as ComponentType[]

export const COMPONENT_CATEGORIES: ComponentCategory[] = [
  'actuator',
  'sensor',
  'imu',
  'odometry',
  'vision',
  'other'
]

export function isComponentType(value: unknown): value is ComponentType {
  return typeof value === 'string' && value in COMPONENT_TYPES
}

export function componentDef(type: ComponentType): ComponentTypeDef {
  return COMPONENT_TYPES[type]
}

export function propertyDefaults(type: ComponentType): Record<string, string | number> {
  return Object.fromEntries(componentDef(type).properties.map((p) => [p.key, p.default]))
}

// 속성이 지금 값들에서 인스펙터에 보이는지(visibleWhen, visibleWhenJoint). jointTypeOf는 오브젝트 id → 그 관절
// 형식(없는 오브젝트나 관절이 없으면 null)이다.
export function isPropertyVisible(
  property: PropertyDef,
  props: Record<string, string | number>,
  jointTypeOf: (objectId: string) => JointType | null = () => null
): boolean {
  const when = property.visibleWhen
  if (when && !when.values.includes(String(props[when.key]))) return false
  const joint = property.visibleWhenJoint
  if (!joint) return true
  const target = props[joint.key]
  const type = typeof target === 'string' && target ? jointTypeOf(target) : null
  return type !== null && (!joint.types || joint.types.includes(type))
}

// 데드휠의 원시 엔코더 틱/m(podType). 지름·CPR이 범위 밖이면 그 속성의 기본값을 쓴다.
export function deadWheelTicksPerMeter(props: Record<string, string | number>): number {
  const inRange = (key: string, range: { default: number; min: number; max: number }): number => {
    const value = Number(props[key])
    return Number.isFinite(value) && value >= range.min && value <= range.max
      ? value
      : range.default
  }
  switch (props.podType) {
    case 'swingarm':
      return GOBILDA_POD_TICKS_PER_MM.swingarm * 1000
    case 'revThroughBore':
      return REV_THROUGH_BORE_CPR / (Math.PI * inRange('podDiameter', POD_DIAMETER))
    case 'custom':
      return inRange('podCpr', POD_CPR) / (Math.PI * inRange('podDiameter', POD_DIAMETER))
    default:
      return GOBILDA_POD_TICKS_PER_MM.fourBar * 1000
  }
}

// Pinpoint의 포드 틱/mm(podType: 4-Bar·스윙암, SDK setEncoderResolution과 같은 값)
export function pinpointPodTicksPerMm(props: Record<string, string | number>): number {
  return props.podType === 'swingarm'
    ? GOBILDA_POD_TICKS_PER_MM.swingarm
    : GOBILDA_POD_TICKS_PER_MM.fourBar
}
