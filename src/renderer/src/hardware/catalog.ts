// 하드웨어 컴포넌트 카탈로그. XML 태그·Java 클래스·I2C 주소는 FTC SDK 12.0 소스(10.3·11.1과 동일)에서 확인한 값만 쓴다.
// 구성 XML 태그는 대소문자를 구분하고, 틀리면 SDK가 오류 없이 장치를 버리므로 추측한 값을 넣지 않는다.

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

export type PropertyDef =
  | { key: string; kind: 'enum'; options: readonly string[]; default: string }
  | {
      key: string
      kind: 'number'
      default: number
      min?: number
      max?: number
      // 표시 소수 자릿수
      digits: number
    }
  | { key: string; kind: 'text'; default: string }
  // 다른 씬 오브젝트(예: 오도메트리 포드 파트)를 가리킨다. 값은 오브젝트 id, 비어 있으면 ''.
  | { key: string; kind: 'object'; default: '' }

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
      { key: 'zeroPowerBehavior', kind: 'enum', options: ['brake', 'float'], default: 'brake' }
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
      { key: 'scaleMax', kind: 'number', default: 1, min: 0, max: 1, digits: 2 }
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
    properties: [DIRECTION]
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
    properties: []
  },
  colorSensor: {
    category: 'sensor',
    portKind: 'i2c',
    defaultName: 'color',
    javaType: 'NormalizedColorSensor',
    imports: ['com.qualcomm.robotcore.hardware.NormalizedColorSensor'],
    i2cAddress: 0x52,
    properties: [{ key: 'gain', kind: 'number', default: 2, min: 1, max: 100, digits: 1 }]
  },
  touchSensor: {
    category: 'sensor',
    portKind: 'digital',
    defaultName: 'touch',
    javaType: 'TouchSensor',
    imports: ['com.qualcomm.robotcore.hardware.TouchSensor'],
    properties: []
  },
  digitalDevice: {
    category: 'sensor',
    portKind: 'digital',
    defaultName: 'digital',
    javaType: 'DigitalChannel',
    imports: ['com.qualcomm.robotcore.hardware.DigitalChannel'],
    properties: [{ key: 'mode', kind: 'enum', options: ['input', 'output'], default: 'input' }]
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
      { key: 'reversed', kind: 'enum', options: ['no', 'yes'], default: 'no' }
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
