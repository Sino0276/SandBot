// 운동학 시뮬레이터의 세계 설명(렌더러 → 메인). 렌더러가 INIT 때 씬에서 고른 로봇의 바퀴·모터·오도메트리를 이 모양으로
// 만들어 PlayInitRequest.world로 보내고, 메인의 KinematicWorld(src/shared/sim/world.ts)가 틱마다 이것으로 센서 값을 만든다.
// 메인은 렌더러를 믿지 않고 parseWorldSpec으로 모양·유한 수·한도를 확인한다.
// 단위는 미터·라디안이다. 로봇 좌표는 X 앞·Y 왼쪽, 각은 반시계 +(로봇 위에서 볼 때). 필드 좌표는 원점 필드 중앙, Z 위.

export const WORLD_SPEC_VERSION = 1

// 한도(메인 검증)
export const MAX_WORLD_MOTORS = 64
export const MAX_WORLD_WHEELS = 32
export const MAX_WORLD_SENSORS = 32
export const MAX_FOOTPRINT_POINTS = 64

export type Vec2 = { x: number; y: number }

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
}

// 시뮬레이터가 렌더러에 보이는 로봇 자세(필드 좌표). blocked: 이번 틱에 필드 벽에 막혔다.
export type SimPose = { x: number; y: number; yaw: number; blocked: boolean }

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
      imus: list(value.imus, MAX_WORLD_SENSORS, 'imus', imu)
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
