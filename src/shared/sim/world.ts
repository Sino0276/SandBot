import type { SimNoticeCode } from '../play'
import type { DeviceValues } from '../sidecarProtocol'
import {
  applyTwist,
  compose,
  Drivetrain,
  inverse,
  twistBetween,
  wrapAngle,
  type Twist
} from './drivetrain'
import { WALL_INNER_HALF } from './field'
import { isEncoderMode, MotorModel, readMotorOutputs, type MotorCommand } from './motorModel'
import { rotationSign } from './motorTypes'
import type {
  Pose2,
  SimDeadWheelSpec,
  SimMotorSpec,
  SimOtosSpec,
  SimPinpointSpec,
  SimPose,
  Vec2,
  WorldSpec
} from './worldSpec'

// 운동학 시뮬레이터(메인 프로세스가 사이드카 틱마다 부른다, src/main/sidecar/world.ts의 SimWorld). 질량·충돌 물리 없이
// 모터 출력 → 출력축 회전(motorModel.ts) → 바퀴 굴림 → 로봇 변위(drivetrain.ts, 최소제곱) → 필드 자세를 계산하고,
// 그 자세로 센서 값(엔코더, IMU, 데드휠, Pinpoint, OTOS)을 만든다. 결과는 입력열(틱 시각과 장치 출력)에만 달려 있다
// (벽시계·난수·순서가 정해지지 않은 자료 구조를 쓰지 않는다).
//
// 시간: step(t, outputs)는 [이전 t, t] 구간을 **이전 틱의 출력**으로 적분한다(사이드카는 틱 경계에서 그 틱의 출력을 보내고,
// 답의 입력은 그 뒤부터 보이므로 구간 동안 장치가 따른 명령은 앞 틱의 것이다). 구간은 1 ms 이하 하위 단계로 나눈다.
// 첫 호출은 적분하지 않고 상태만 만든 뒤 모든 입력을 보낸다. 그 뒤는 값이 바뀐 키만 보낸다.
//
// 부호: 모터 power·velocity·position은 허브 부호다(사이드카 package-info.java). 인스펙터 방향(spec.directionSign)은
// "+power면 바퀴가 앞으로 구른다"는 뜻이므로, 바퀴 앞 굴림 = 허브 각 × 형식 회전 부호 × 인스펙터 방향 부호다.
// 그래서 팀 코드가 인스펙터와 같은 setDirection을 쓰면 getCurrentPosition은 앞으로 갈 때 는다.
//
// 벽: 외곽 다각형의 꼭짓점이 벽 안쪽 면(±WALL_INNER_HALF)을 넘으면 평행 이동으로만 밀어낸다(회전은 그대로). 이번
// 하위 단계의 이동이 침투를 늘린 만큼만 되돌리므로 시작부터 벽에 걸쳐 있어도 튀지 않는다. 막혀도 모터 축(엔코더)은
// 계속 돌고, 실제로 움직인 만큼만 데드휠·Pinpoint 포드·OTOS가 잰다.

export const SUBSTEP_NANOS = 1_000_000
// 한 번에 이보다 많은 하위 단계로 나누지 않는다(아주 긴 구간은 하위 단계가 1 ms보다 길어진다)
const MAX_SUBSTEPS = 10_000
// 침투가 이보다 적게 늘면 막힘으로 치지 않는다(부동 소수점 잡음)
const WALL_EPSILON = 1e-12

type Notice = { code: SimNoticeCode; params: Record<string, string> }

type DeadWheel = {
  spec: SimDeadWheelSpec
  // 원시 허브 틱(소수)과 앞 틱의 값(속도)
  raw: number
  rawAtTick: number
}

type Motor = {
  spec: SimMotorSpec
  model: MotorModel
  // 허브 각 → 바퀴 앞 굴림 부호
  forwardSign: number
  // 같은 장치 이름의 데드휠(실제 배선: 그 포트의 엔코더는 포드다)
  pod: DeadWheel | null
  // RUN_TO_POSITION의 원시 목표를 만드는 기준(축 틱). 포드와 포트를 함께 쓰지 않으면 encoderOffset 그대로다.
  shaftOffset: number
  lastEncoderOffset: number
}

type Pinpoint = {
  spec: SimPinpointSpec
  // 원시 포드 틱(소수, 방향 적용 전)
  encX: number
  encY: number
  // 펌웨어가 적분한 자세(mm, 전원 켠 뒤 틀: X 앞·Y 왼쪽)와 앞 틱의 값(속도)
  x: number
  y: number
  xAtTick: number
  yAtTick: number
}

type Otos = {
  spec: SimOtosSpec
  // 물리 센서 틀(로봇 좌표): 위치 + (장착 각 − 90°). SDK 샘플 축(X 오른쪽·Y 앞)이 로봇 X 앞·Y 왼쪽에서 −90°다.
  mount: Pose2
  // 전원을 켤 때(첫 step)의 센서 자세(필드)
  sensorAtStart: Pose2
  // 앞 틱의 센서 자세(필드)와 원시 속도(가속도)
  sensorAtTick: Pose2
  velocity: { vx: number; vy: number; vh: number }
}

type State = Map<string, Map<string, number>>

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

// 장치 이름으로 출력을 찾는다(자기 속성만: 이름이 '__proto__'여도 프로토타입을 읽지 않게)
function own(outputs: Record<string, DeviceValues>, device: string): DeviceValues | undefined {
  return Object.prototype.hasOwnProperty.call(outputs, device) ? outputs[device] : undefined
}

export class KinematicWorld {
  private readonly spec: WorldSpec
  private readonly drivetrain: Drivetrain
  private readonly motors: Motor[]
  private readonly deadWheels: DeadWheel[]
  private readonly pinpoints: Pinpoint[]
  private readonly otos: Otos[]
  // 바퀴 i를 구동하는 모터의 motors 순번(spec.wheels 순서), 없으면 −1
  private readonly wheelMotors: number[]

  private tPrev: number | null = null
  private outputsPrev: Record<string, DeviceValues> = {}
  private poseNow: Pose2
  private blocked = false
  private readonly sent: State = new Map()
  private readonly notices: Notice[] = []
  private readonly noticeKeys = new Set<string>()

  constructor(spec: WorldSpec) {
    this.spec = spec
    this.poseNow = { ...spec.robot.start }
    this.drivetrain = new Drivetrain(spec.wheels)
    this.deadWheels = spec.deadWheels.map((d) => ({ spec: d, raw: 0, rawAtTick: 0 }))
    const podByName = new Map<string, DeadWheel>()
    for (const pod of this.deadWheels) podByName.set(pod.spec.device, pod)
    this.motors = spec.motors.map((m) => {
      const model = new MotorModel(m.modelTag, m.gearbox)
      return {
        spec: m,
        model,
        forwardSign: rotationSign(model.type) * m.directionSign,
        pod: podByName.get(m.device) ?? null,
        shaftOffset: 0,
        lastEncoderOffset: 0
      }
    })
    this.wheelMotors = spec.wheels.map((w) =>
      w.motor === null ? -1 : spec.motors.findIndex((m) => m.device === w.motor)
    )
    this.pinpoints = spec.pinpoints.map((p) => ({
      spec: p,
      encX: 0,
      encY: 0,
      x: 0,
      y: 0,
      xAtTick: 0,
      yAtTick: 0
    }))
    this.otos = spec.otos.map((o) => {
      const mount = { x: o.position.x, y: o.position.y, yaw: o.mountingAngle - Math.PI / 2 }
      const sensor = compose(spec.robot.start, mount)
      return {
        spec: o,
        mount,
        sensorAtStart: sensor,
        sensorAtTick: sensor,
        velocity: { vx: 0, vy: 0, vh: 0 }
      }
    })
  }

  step(tNanos: number, outputs: Record<string, DeviceValues>): Record<string, DeviceValues> {
    const first = this.tPrev === null
    const dtNanos = first ? 0 : tNanos - (this.tPrev as number)
    this.blocked = false
    const yawBefore = this.poseNow.yaw
    if (dtNanos > 0) this.integrate(dtNanos)
    if (dtNanos > 0 || first) this.tPrev = tNanos
    this.checkSharedPorts(outputs)
    this.outputsPrev = outputs
    return this.changed(this.inputs(Math.max(0, dtNanos) / 1e9, yawBefore), first)
  }

  pose(): SimPose {
    return { x: this.poseNow.x, y: this.poseNow.y, yaw: this.poseNow.yaw, blocked: this.blocked }
  }

  drainNotices(): Notice[] {
    return this.notices.splice(0, this.notices.length)
  }

  // ---- 적분 ----

  private integrate(dtNanos: number): void {
    const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(dtNanos / SUBSTEP_NANOS)))
    const h = dtNanos / 1e9 / steps
    const voltage = this.spec.batteryVoltage
    const commands: MotorCommand[] = this.motors.map((motor) => {
      const out = readMotorOutputs(own(this.outputsPrev, motor.spec.device))
      // 포드와 포트를 함께 쓰면 사이드카의 encoderOffset은 포드 틱이다. 시뮬레이터는 축 엔코더로 제어하므로 리셋을
      // 본 때의 축 틱을 기준으로 삼는다.
      if (motor.pod) {
        if (out.encoderOffset !== motor.lastEncoderOffset || out.mode === 'STOP_AND_RESET_ENCODER')
          motor.shaftOffset = Math.floor(motor.model.raw)
      } else {
        motor.shaftOffset = out.encoderOffset
      }
      motor.lastEncoderOffset = out.encoderOffset
      return motor.model.command(out, voltage, motor.shaftOffset)
    })
    const rolls = new Array<number>(this.spec.wheels.length).fill(0)
    const angles = new Array<number>(this.motors.length).fill(0)
    for (let s = 0; s < steps; s++) {
      this.motors.forEach((motor, i) => {
        angles[i] = motor.model.advance(commands[i], h)
      })
      this.spec.wheels.forEach((wheel, i) => {
        const index = this.wheelMotors[i]
        rolls[i] =
          index < 0
            ? 0
            : ((angles[index] * this.motors[index].forwardSign) / wheel.gearRatio) * wheel.radius
      })
      this.moveRobot(this.drivetrain.twist(rolls))
    }
  }

  // 로봇을 변위만큼 움직이고(벽에 막히면 평행 이동만 줄인다) 실제로 움직인 만큼 오도메트리를 센다
  private moveRobot(twist: Twist): void {
    if (twist.dx === 0 && twist.dy === 0 && twist.dTheta === 0) return
    const from = this.poseNow
    let to = applyTwist(from, twist)
    const pushed = this.pushFromWalls(from, to)
    let actual = twist
    if (pushed) {
      to = pushed
      this.blocked = true
      actual = twistBetween(from, to)
    }
    this.poseNow = to
    for (const pod of this.deadWheels)
      pod.raw += podTravel(actual, pod.spec.position, pod.spec.measures) * podScale(pod.spec)
    for (const pinpoint of this.pinpoints) this.pinpointStep(pinpoint, actual, from.yaw, to.yaw)
  }

  // 벽 안쪽 면을 넘은 꼭짓점이 늘었으면 평행 이동으로 되돌린 자세, 아니면 null
  private pushFromWalls(from: Pose2, to: Pose2): Pose2 | null {
    const before = extent(this.spec.robot.footprint, from)
    const after = extent(this.spec.robot.footprint, to)
    const limit = WALL_INNER_HALF
    let { x, y } = to
    let pushed = false
    const grow = (now: number, then: number): number => {
      const added = Math.max(0, now) - Math.max(0, then)
      return added > WALL_EPSILON ? added : 0
    }
    const px = grow(after.maxX - limit, before.maxX - limit)
    const nx = grow(-limit - after.minX, -limit - before.minX)
    const py = grow(after.maxY - limit, before.maxY - limit)
    const ny = grow(-limit - after.minY, -limit - before.minY)
    if (px > 0 || nx > 0) {
      x += nx - px
      pushed = true
    }
    if (py > 0 || ny > 0) {
      y += ny - py
      pushed = true
    }
    return pushed ? { x, y, yaw: to.yaw } : null
  }

  // Pinpoint 펌웨어: 포드 틱(정수, 팀이 정한 방향 적용)과 팀이 쓴 해상도·오프셋, 내장 IMU 요(진짜 요)로 추적점의 이동을
  // 전원 켠 뒤 틀(X 앞·Y 왼쪽, mm)에 적분한다. X 포드(옆 위치 xOffset, 왼쪽 +)는 앞 이동 − Δh·xOffset을,
  // Y 포드(앞 위치 yOffset)는 옆 이동 + Δh·yOffset을 재므로 그만큼 되돌린다. heading은 감지 않는다.
  private pinpointStep(p: Pinpoint, actual: Twist, yawFrom: number, yawTo: number): void {
    const scale = p.spec.podTicksPerMm * 1000
    const oldX = Math.floor(p.encX)
    const oldY = Math.floor(p.encY)
    if (p.spec.xPod)
      p.encX += podTravel(actual, p.spec.xPod, 'forward') * scale * (p.spec.xReversed ? -1 : 1)
    if (p.spec.yPod)
      p.encY += podTravel(actual, p.spec.yPod, 'strafe') * scale * (p.spec.yReversed ? -1 : 1)
    const out = own(this.outputsPrev, p.spec.device)
    const ticksPerMm = finite(out?.ticksPerMm, 0)
    if (!(ticksPerMm > 0)) return
    const xSign = out?.xDirection === 'REVERSED' ? -1 : 1
    const ySign = out?.yDirection === 'REVERSED' ? -1 : 1
    const podX = ((Math.floor(p.encX) - oldX) * xSign) / ticksPerMm
    const podY = ((Math.floor(p.encY) - oldY) * ySign) / ticksPerMm
    const start = this.spec.robot.start.yaw
    const h0 = yawFrom - start
    const h1 = yawTo - start
    const dh = h1 - h0
    const dx = podX + dh * finite(out?.xOffsetMm, 0)
    const dy = podY - dh * finite(out?.yOffsetMm, 0)
    const mid = (h0 + h1) / 2
    p.x += dx * Math.cos(mid) - dy * Math.sin(mid)
    p.y += dx * Math.sin(mid) + dy * Math.cos(mid)
  }

  // 데드휠과 포트를 함께 쓰는 모터를 엔코더 모드로 돌리면 한 번 알린다
  private checkSharedPorts(outputs: Record<string, DeviceValues>): void {
    for (const motor of this.motors) {
      if (!motor.pod) continue
      if (isEncoderMode(readMotorOutputs(own(outputs, motor.spec.device)).mode))
        this.notify('sharedEncoderMode', { device: motor.spec.device })
    }
  }

  private notify(code: SimNoticeCode, params: Record<string, string>): void {
    const key = JSON.stringify([code, params])
    if (this.noticeKeys.has(key)) return
    this.noticeKeys.add(key)
    this.notices.push({ code, params })
  }

  // ---- 입력 ----

  // 지금 상태의 모든 입력(장치 → 키 → 값). dt: 이번 구간(초, 첫 호출은 0), yawBefore: 구간 시작의 요.
  private inputs(dt: number, yawBefore: number): State {
    const state: State = new Map()
    const put = (device: string, key: string, value: number): void => {
      let values = state.get(device)
      if (!values) {
        values = new Map()
        state.set(device, values)
      }
      values.set(key, value)
    }
    const rate = (now: number, then: number): number => (dt > 0 ? (now - then) / dt : 0)

    for (const hub of this.spec.hubs) put(hub, 'voltage', this.spec.batteryVoltage)

    for (const motor of this.motors) {
      if (motor.pod) continue
      put(motor.spec.device, 'position', Math.floor(motor.model.raw))
      put(motor.spec.device, 'velocity', Math.round(motor.model.ticksPerSecond))
    }
    for (const pod of this.deadWheels) {
      put(pod.spec.device, 'position', Math.floor(pod.raw))
      put(pod.spec.device, 'velocity', Math.round(rate(pod.raw, pod.rawAtTick)))
      pod.rawAtTick = pod.raw
    }

    const start = this.spec.robot.start.yaw
    const yaw = this.poseNow.yaw - start
    const yawRate = rate(this.poseNow.yaw, yawBefore)

    for (const p of this.pinpoints) {
      put(p.spec.device, 'x', p.x)
      put(p.spec.device, 'y', p.y)
      put(p.spec.device, 'heading', yaw)
      put(p.spec.device, 'vx', rate(p.x, p.xAtTick))
      put(p.spec.device, 'vy', rate(p.y, p.yAtTick))
      put(p.spec.device, 'headingVelocity', yawRate)
      put(p.spec.device, 'encoderX', Math.floor(p.encX))
      put(p.spec.device, 'encoderY', Math.floor(p.encY))
      p.xAtTick = p.x
      p.yAtTick = p.y
    }

    for (const o of this.otos) this.otosInputs(o, dt, put)

    for (const imu of this.spec.imus) {
      put(imu.device, 'yaw', wrapAngle(yaw))
      put(imu.device, 'pitch', 0)
      put(imu.device, 'roll', 0)
      put(imu.device, 'yawRate', yawRate)
      put(imu.device, 'pitchRate', 0)
      put(imu.device, 'rollRate', 0)
    }
    return state
  }

  // OTOS: 물리 센서 틀 S와 팀이 쓴 오프셋 O(SDK 샘플 축)로 가상 로봇 틀 V = S∘O⁻¹, 원시 자세 = V(0)⁻¹∘V(t)
  // = O∘S(0)⁻¹∘S(t)∘O⁻¹. 오프셋이 SDK 샘플 규약(X 오른쪽·Y 앞)이든 Road Runner식(X 앞·Y 왼쪽, h = −90°)이든 그 틀의
  // 로봇 중심 자세가 된다. 속도·가속도는 원시 틀에서 틱 사이의 차이다.
  private otosInputs(
    o: Otos,
    dt: number,
    put: (device: string, key: string, value: number) => void
  ): void {
    const out = own(this.outputsPrev, o.spec.device)
    const offset: Pose2 = {
      x: finite(out?.offsetX, 0),
      y: finite(out?.offsetY, 0),
      yaw: finite(out?.offsetH, 0)
    }
    const sensor = compose(this.poseNow, o.mount)
    const relative = (s: Pose2): Pose2 =>
      compose(compose(offset, compose(inverse(o.sensorAtStart), s)), inverse(offset))
    const raw = relative(sensor)
    let velocity = { vx: 0, vy: 0, vh: 0 }
    if (dt > 0) {
      const before = relative(o.sensorAtTick)
      velocity = {
        vx: (raw.x - before.x) / dt,
        vy: (raw.y - before.y) / dt,
        vh: (raw.yaw - before.yaw) / dt
      }
    }
    const prev = o.velocity
    const device = o.spec.device
    put(device, 'x', raw.x)
    put(device, 'y', raw.y)
    put(device, 'h', raw.yaw)
    put(device, 'vx', velocity.vx)
    put(device, 'vy', velocity.vy)
    put(device, 'vh', velocity.vh)
    put(device, 'ax', dt > 0 ? (velocity.vx - prev.vx) / dt : 0)
    put(device, 'ay', dt > 0 ? (velocity.vy - prev.vy) / dt : 0)
    put(device, 'ah', dt > 0 ? (velocity.vh - prev.vh) / dt : 0)
    o.sensorAtTick = sensor
    o.velocity = velocity
  }

  // 지난번에 보낸 값과 다른 키만(첫 호출은 전부). 유한하지 않은 값은 보내지 않는다. 장치 이름은 팀 구성에서 오므로
  // ('__proto__' 등) 객체 키로 바로 쓰지 않고 Object.fromEntries로 만든다.
  private changed(state: State, all: boolean): Record<string, DeviceValues> {
    const result: [string, DeviceValues][] = []
    for (const [device, values] of state) {
      let sent = this.sent.get(device)
      if (!sent) {
        sent = new Map()
        this.sent.set(device, sent)
      }
      const entries: [string, number][] = []
      for (const [key, value] of values) {
        if (!Number.isFinite(value)) continue
        // −0은 0으로(JSON은 같지만 비교를 단순하게)
        const v = value === 0 ? 0 : value
        if (!all && sent.get(key) === v) continue
        sent.set(key, v)
        entries.push([key, v])
      }
      if (entries.length > 0) result.push([device, Object.fromEntries(entries)])
    }
    return Object.fromEntries(result)
  }
}

// 포드 접점이 잰 이동(m): 로봇 좌표 변위 ξ에서 그 점의 이동 성분. forward는 로봇 +X, strafe는 +Y(왼쪽).
// 점 p의 이동 = (dx − dθ·p_y, dy + dθ·p_x)(일정한 변위 동안 로봇 좌표에서 일정하다)
function podTravel(twist: Twist, p: Vec2, measures: 'forward' | 'strafe'): number {
  return measures === 'forward' ? twist.dx - twist.dTheta * p.y : twist.dy + twist.dTheta * p.x
}

function podScale(spec: SimDeadWheelSpec): number {
  return spec.ticksPerMeter * (spec.reversed ? -1 : 1)
}

// 외곽 다각형(로봇 좌표)을 자세에 놓았을 때 필드 좌표의 범위
function extent(
  footprint: readonly Vec2[],
  pose: Pose2
): { minX: number; maxX: number; minY: number; maxY: number } {
  const cos = Math.cos(pose.yaw)
  const sin = Math.sin(pose.yaw)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of footprint) {
    const x = pose.x + cos * p.x - sin * p.y
    const y = pose.y + sin * p.x + cos * p.y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, maxX, minY, maxY }
}
