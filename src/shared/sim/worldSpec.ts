// 운동학 시뮬레이터의 세계 설명(렌더러 → 메인). 렌더러가 INIT 때 씬에서 고른 로봇의 바퀴·모터·오도메트리를 이 모양으로
// 만들어 PlayInitRequest.world로 보내고, 메인의 KinematicWorld(src/shared/sim/world.ts)가 틱마다 이것으로 센서 값을 만든다.
// 메인은 렌더러를 믿지 않고 parseWorldSpec으로 모양·유한 수·한도를 확인한다.
// 단위는 미터·라디안이다. 로봇 좌표는 X 앞·Y 왼쪽, 각은 반시계 +(로봇 위에서 볼 때). 필드 좌표는 원점 필드 중앙, Z 위.

export const WORLD_SPEC_VERSION = 2

// 한도(메인 검증)
export const MAX_WORLD_MOTORS = 64
export const MAX_WORLD_WHEELS = 32
export const MAX_WORLD_SENSORS = 32
export const MAX_FOOTPRINT_POINTS = 64
// 관절(3b, 메커니즘). FTC 로봇은 보통 2–8개(리프트 2–3단, 팔, 손목, 집게)
export const MAX_WORLD_JOINTS = 16
// 한 관절을 같이 구동하는 모터(양쪽 리프트 등)
export const MAX_JOINT_MOTORS = 4

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }
// 관성 행렬 성분 [Ixx, Iyy, Izz, Ixy, Ixz, Iyz](행렬 값 그대로, Ixy = −∫xy dm), kg·m²
export type SimInertia = [number, number, number, number, number, number]

// 필드 좌표의 로봇 자세(최상위 로봇 transform의 x·y와 요)
export type Pose2 = { x: number; y: number; yaw: number }

// 모터 하나(구성의 모터 장치). 바퀴든 메커니즘이든 모든 모터 컴포넌트가 들어간다(엔코더 값을 만들려고).
export type SimMotorSpec = {
  // 구성 이름(hardwareMap 이름 = 사이드카 장치 이름)
  device: string
  // 구성 XML 태그(hardware/catalog.ts의 MOTOR_MODEL_TAGS 값, 예: 'goBILDA5202SeriesMotor').
  // 형식의 ticksPerRev·gearing·maxRPM·회전 방향은 src/shared/sim/motorTypes.ts(사이드카 MotorConfigurationType과 같음).
  modelTag: string
  // 실제로 단 기어박스 감속비(예: goBILDA 312 RPM은 19.2). SDK 형식은 계열당 한 비만 알아서(5202 계열 99.5,
  // UltraPlanetary 20) 출력축 1회전 틱 = ticksPerRev ÷ gearing × gearbox, 무부하 출력축 RPM = maxRPM × gearing ÷ gearbox.
  gearbox: number
  // 인스펙터의 방향(생성 코드의 setDirection): forward 1, reverse −1. "+power면 바퀴가 앞으로 구르는 방향"으로 본다.
  directionSign: 1 | -1
}

export type WheelKind = 'mecanum' | 'omni' | 'traction'

// 메카넘 롤러 형(위에서 볼 때 롤러가 X를 이루는 표준 배치에서): flbr = 앞왼쪽·뒤오른쪽 자리의 바퀴,
// frbl = 앞오른쪽·뒤왼쪽 자리의 바퀴. 구동 방향은 flbr이 R(−45°)·u, frbl이 R(+45°)·u(u = 굴림 방향 단위 벡터).
export type MecanumRollers = 'flbr' | 'frbl'

export type SimWheelSpec = {
  // 바퀴 중심(로봇 좌표, 바닥 평면)
  position: Vec2
  // 굴림 방향(앞으로 구를 때 바퀴가 미는 방향)의 각, 로봇 +X 기준 반시계
  angle: number
  kind: WheelKind
  // 메카넘만(렌더러가 auto를 풀어서 보낸다), 나머지는 null
  rollers: MecanumRollers | null
  radius: number
  // 모터 출력축 → 바퀴 외부 감속비(> 0, 1이면 직결)
  gearRatio: number
  // 구동 모터의 장치 이름(motors 중 하나). null이면 구동하지 않는 바퀴(일반 바퀴는 옆 미끄럼만 막는다)
  motor: string | null
}

// 데드휠(엔코더 포트의 오도메트리 포드). 장치 이름은 javaCodegen의 deadWheelDeviceName(같은 포트의 모터가 있으면 그 이름).
export type SimDeadWheelSpec = {
  device: string
  // 포드 바퀴 접점(로봇 좌표)
  position: Vec2
  // forward: 로봇 +X 이동을 잰다, strafe: 로봇 +Y(왼쪽) 이동을 잰다
  measures: 'forward' | 'strafe'
  // 원시 허브 틱이 반대로 센다(인스펙터 reversed, DcMotor 방향 적용 전)
  reversed: boolean
  ticksPerMeter: number
}

// goBILDA Pinpoint. 펌웨어처럼 포드 틱과 팀이 쓴 설정(ticksPerMm·방향·오프셋)으로 자세를 계산한다.
export type SimPinpointSpec = {
  device: string
  // X 포드(앞 이동을 잼)·Y 포드(왼쪽 이동을 잼)의 접점(로봇 좌표). 지정하지 않았으면 null(그 포드는 0)
  xPod: Vec2 | null
  yPod: Vec2 | null
  // 포드 실제 해상도(인스펙터 podType: fourBar 19.89436789, swingarm 13.26291192 틱/mm)
  podTicksPerMm: number
  // 원시 포드 틱이 반대로 센다(인스펙터 xDirection·yDirection이 reversed). setEncoderDirections를 인스펙터대로 하면 앞·왼쪽이 +.
  xReversed: boolean
  yReversed: boolean
}

// SparkFun OTOS. 물리 센서 틀 = 장착 위치 + 장착 각(SDK 샘플 축: X 오른쪽·Y 앞·반시계 +).
export type SimOtosSpec = {
  device: string
  position: Vec2
  // 인스펙터 mountingAngle(라디안, 반시계 +)
  mountingAngle: number
}

export type SimImuSpec = { device: string }

export type WorldSpec = {
  version: typeof WORLD_SPEC_VERSION
  robot: {
    // 시작 자세(필드 좌표)
    start: Pose2
    // 바닥 외곽(로봇 좌표 볼록 다각형, 보통 사각형 4점). 필드 벽 막힘에 쓴다.
    footprint: Vec2[]
  }
  // 배터리 전압(V). 모터 무부하 속도 비율(전압 ÷ 12)과 허브 voltage 입력.
  batteryVoltage: number
  // 허브 장치 이름(구성의 LynxModule 이름: 'Control Hub', 'Expansion Hub 2' …), voltage 입력을 보낸다
  hubs: string[]
  motors: SimMotorSpec[]
  wheels: SimWheelSpec[]
  deadWheels: SimDeadWheelSpec[]
  pinpoints: SimPinpointSpec[]
  otos: SimOtosSpec[]
  imus: SimImuSpec[]
  // 메커니즘 관절(3b). 부모가 먼저 온다. 비면 운동학 2단계와 같다.
  joints: SimJointSpec[]
}

// ---- 관절(3b, spec-3b §4, Unity ArticulationBody 하나 = 관절 하나 = 움직이는 몸체 하나) ----

// 기어모터 하나의 물리 값(렌더러가 데이터시트 표에서 풀어 넣는다). 출력축 기준 토크·속도·전류, 모터축 기준 관성·마찰.
export type SimMotorParams = {
  // N·m, 12 V 정지 토크(출력축, 기어 효율 포함한 제조사 값)
  stallTorque: number
  // rad/s, 12 V 무부하 속도(출력축)
  freeSpeed: number
  // A
  stallCurrent: number
  freeCurrent: number
  // 모터축 → 출력축 감속비(실제 기어박스)
  gearbox: number
  // 0–1, 모터가 밀 때의 기어 효율
  efficiency: number
  // kg·m², 모터축 회전자 관성
  rotorInertia: number
  // N·m, 모터축 역구동 마찰(쿨롱)
  backdriveFriction: number
}

export type SimServoParams = {
  // N·m, 정지 토크(서보 출력축)
  stallTorque: number
  // rad/s, 무부하 속도
  freeSpeed: number
  // rad, SDK 기본 PWM 범위(600–2400 µs) 전체의 서보 각(CR 서보는 0)
  rangeAngle: number
  // µs
  deadbandUs: number
  // 내부 위치 제어 근사(N·m/rad, N·m·s/rad)
  kp: number
  kd: number
  // CR 서보가 최대 속도에 닿는 |power|(SDK 범위 기준), 위치 서보는 1
  crFullPower: number
  // N·m, PWM이 꺼졌을 때 남는 기어 마찰
  limpFriction: number
}

export type SimJointDriveSpec =
  | { kind: 'none' }
  // devices: motors의 장치 이름(1–MAX_JOINT_MOTORS). ratio: 회전 관절은 모터 출력축 rad당 관절 rad(부호 포함),
  // 직선 관절은 출력축 rad당 m(스풀 반지름 × 외부 감속). rigging: 다단 슬라이드(stages는 위 단 관절 순번, 아래에서 위)
  | {
      kind: 'motor'
      devices: string[]
      ratio: number
      params: SimMotorParams
      rigging: { kind: 'direct' } | { kind: 'cascade' | 'continuous'; stages: number[] }
    }
  | { kind: 'servo' | 'crServo'; device: string; ratio: number; params: SimServoParams }
  // 다단 슬라이드의 위 단(아래 단 구동의 rigging.stages에 들어 있다)
  | { kind: 'stage' }

export type SimJointSpec = {
  // 부모 관절 순번(자기보다 앞), −1이면 로봇(움직이지 않는 뿌리)
  parent: number
  type: 'revolute' | 'prismatic'
  // q = 0(편집 자세)의 관절 틀: 부모 몸체 틀 기준(부모가 로봇이면 로봇 좌표). 회전은 ZYX 오일러 rad
  origin: { position: Vec3; rotation: Vec3 }
  // 관절 틀의 단위 축(회전은 오른손 +, 직선은 그 방향 +)
  axis: Vec3
  // q = 0 기준(rad 또는 m). null이면 제한 없음(회전 관절만)
  limits: { lower: number; upper: number } | null
  // 이 관절 몸체만(안쪽 관절 몸체 제외)의 질량 성질, 관절 틀 기준
  body: { mass: number; centerOfMass: Vec3; inertia: SimInertia }
  // 관절 좌표 단위: 쿨롱(N·m 또는 N), 점성(N·m·s/rad 또는 N·s/m)
  friction: { coulomb: number; viscous: number }
  spring:
    | null
    | { kind: 'constantForce'; force: number }
    | { kind: 'linear'; stiffness: number; rest: number }
  drive: SimJointDriveSpec
  // 한계 근처에서 눌리는 리밋 스위치: touch는 pressed true, digital은 state false
  switches: { device: string; kind: 'touch' | 'digital'; at: 'lower' | 'upper'; within: number }[]
}

// 시뮬레이터가 렌더러에 보이는 로봇 자세(필드 좌표). blocked: 이번 틱에 필드 벽에 막혔다.
// joints: 관절 순번 순 q(rad 또는 m). 관절이 없는 세계는 키를 넣지 않는다.
export type SimPose = { x: number; y: number; yaw: number; blocked: boolean; joints?: number[] }

// ---- 검증(메인이 렌더러에서 받은 값을 확인한다) ----

const MAX_NAME = 256
// 위치·크기 한도(m): 필드(3.66 m)보다 넉넉히
const MAX_COORD = 10

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const inRange = (value: unknown, min: number, max: number): value is number =>
  finite(value) && value >= min && value <= max
const name = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= MAX_NAME

class SpecError extends Error {}

function fail(what: string): never {
  throw new SpecError(what)
}

function vec2(value: unknown, what: string): Vec2 {
  if (!isRecord(value)) fail(what)
  const { x, y } = value
  if (!inRange(x, -MAX_COORD, MAX_COORD) || !inRange(y, -MAX_COORD, MAX_COORD)) fail(what)
  return { x, y }
}

function angle(value: unknown, what: string): number {
  if (!inRange(value, -4 * Math.PI, 4 * Math.PI)) fail(what)
  return value
}

function list<T>(
  value: unknown,
  max: number,
  what: string,
  item: (v: unknown, i: number) => T
): T[] {
  if (!Array.isArray(value) || value.length > max) fail(what)
  return value.map((v, i) => item(v, i))
}

function motor(value: unknown, i: number): SimMotorSpec {
  const what = `motors[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, modelTag, gearbox, directionSign } = value
  if (!name(device)) fail(`${what}.device`)
  if (!name(modelTag)) fail(`${what}.modelTag`)
  if (!inRange(gearbox, 0.01, 10000)) fail(`${what}.gearbox`)
  if (directionSign !== 1 && directionSign !== -1) fail(`${what}.directionSign`)
  return { device, modelTag, gearbox, directionSign }
}

function wheel(value: unknown, i: number): SimWheelSpec {
  const what = `wheels[${i}]`
  if (!isRecord(value)) fail(what)
  const { position, kind, rollers, radius, gearRatio, motor: motorName } = value
  if (kind !== 'mecanum' && kind !== 'omni' && kind !== 'traction') fail(`${what}.kind`)
  if (kind === 'mecanum' ? rollers !== 'flbr' && rollers !== 'frbl' : rollers !== null)
    fail(`${what}.rollers`)
  if (!inRange(radius, 0.001, 1)) fail(`${what}.radius`)
  if (!inRange(gearRatio, 0.001, 1000)) fail(`${what}.gearRatio`)
  if (motorName !== null && !name(motorName)) fail(`${what}.motor`)
  return {
    position: vec2(position, `${what}.position`),
    angle: angle(value.angle, `${what}.angle`),
    kind,
    rollers: rollers as MecanumRollers | null,
    radius,
    gearRatio,
    motor: motorName
  }
}

function deadWheel(value: unknown, i: number): SimDeadWheelSpec {
  const what = `deadWheels[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, position, measures, reversed, ticksPerMeter } = value
  if (!name(device)) fail(`${what}.device`)
  if (measures !== 'forward' && measures !== 'strafe') fail(`${what}.measures`)
  if (typeof reversed !== 'boolean') fail(`${what}.reversed`)
  if (!inRange(ticksPerMeter, 1, 1e8)) fail(`${what}.ticksPerMeter`)
  return { device, position: vec2(position, `${what}.position`), measures, reversed, ticksPerMeter }
}

function pinpoint(value: unknown, i: number): SimPinpointSpec {
  const what = `pinpoints[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, xPod, yPod, podTicksPerMm, xReversed, yReversed } = value
  if (!name(device)) fail(`${what}.device`)
  if (!inRange(podTicksPerMm, 0.001, 1e5)) fail(`${what}.podTicksPerMm`)
  if (typeof xReversed !== 'boolean' || typeof yReversed !== 'boolean') fail(`${what}.reversed`)
  return {
    device,
    xPod: xPod === null ? null : vec2(xPod, `${what}.xPod`),
    yPod: yPod === null ? null : vec2(yPod, `${what}.yPod`),
    podTicksPerMm,
    xReversed,
    yReversed
  }
}

function otos(value: unknown, i: number): SimOtosSpec {
  const what = `otos[${i}]`
  if (!isRecord(value)) fail(what)
  const { device, position, mountingAngle } = value
  if (!name(device)) fail(`${what}.device`)
  return {
    device,
    position: vec2(position, `${what}.position`),
    mountingAngle: angle(mountingAngle, `${what}.mountingAngle`)
  }
}

function imu(value: unknown, i: number): SimImuSpec {
  const what = `imus[${i}]`
  if (!isRecord(value) || !name(value.device)) fail(what)
  return { device: value.device }
}

// 모양이 맞으면 새 객체(받은 값의 다른 키는 버린다), 아니면 무엇이 틀렸는지 글자로 돌려준다
export function parseWorldSpec(value: unknown): WorldSpec | string {
  try {
    if (!isRecord(value)) fail('not an object')
    if (value.version !== WORLD_SPEC_VERSION) fail('version')
    const robot = value.robot
    if (!isRecord(robot) || !isRecord(robot.start)) fail('robot')
    const start = robot.start
    const footprint = list(robot.footprint, MAX_FOOTPRINT_POINTS, 'robot.footprint', (v, i) =>
      vec2(v, `robot.footprint[${i}]`)
    )
    if (footprint.length < 3) fail('robot.footprint')
    const { batteryVoltage } = value
    if (!inRange(batteryVoltage, 1, 30)) fail('batteryVoltage')
    const spec: WorldSpec = {
      version: WORLD_SPEC_VERSION,
      robot: {
        start: {
          x: vec2({ x: start.x, y: start.y }, 'robot.start').x,
          y: vec2({ x: start.x, y: start.y }, 'robot.start').y,
          yaw: angle(start.yaw, 'robot.start.yaw')
        },
        footprint
      },
      batteryVoltage,
      hubs: list(value.hubs, 16, 'hubs', (v, i) => (name(v) ? v : fail(`hubs[${i}]`))),
      motors: list(value.motors, MAX_WORLD_MOTORS, 'motors', motor),
      wheels: list(value.wheels, MAX_WORLD_WHEELS, 'wheels', wheel),
      deadWheels: list(value.deadWheels, MAX_WORLD_SENSORS, 'deadWheels', deadWheel),
      pinpoints: list(value.pinpoints, MAX_WORLD_SENSORS, 'pinpoints', pinpoint),
      otos: list(value.otos, MAX_WORLD_SENSORS, 'otos', otos),
      imus: list(value.imus, MAX_WORLD_SENSORS, 'imus', imu),
      // 계약 단계: 관절 검증은 갈래 A가 채운다(지금은 빈 목록만 받는다)
      joints: list(value.joints, 0, 'joints', () => fail('joints'))
    }
    const motorNames = new Set(spec.motors.map((m) => m.device))
    if (motorNames.size !== spec.motors.length) fail('motors: duplicate device')
    spec.wheels.forEach((w, i) => {
      if (w.motor !== null && !motorNames.has(w.motor)) fail(`wheels[${i}].motor: unknown device`)
    })
    return spec
  } catch (error) {
    if (error instanceof SpecError) return error.message
    throw error
  }
}
