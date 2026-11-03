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
import {
  DcGearMotor,
  DEFAULT_POSITION_PIDF,
  DEFAULT_VELOCITY_PIDF,
  FLOAT,
  HUB_CONTROL_PERIOD_NANOS,
  HubMotorController,
  readPidf,
  SERVO_CENTER_US,
  servoCommand,
  servoTerms,
  type PowerStage,
  type ServoCommand
} from './actuators'
import { Articulation, type DriveForces } from './articulation'
import { HubVelocityWindow } from './encoderVelocity'
import { WALL_INNER_HALF } from './field'
import {
  isEncoderMode,
  MotorModel,
  readMotorOutputs,
  type MotorCommand,
  type MotorOutputs
} from './motorModel'
import { jointEncoderTicksPerOutputRev } from './actuatorData'
import { motorType, rotationSign } from './motorTypes'
import type {
  Pose2,
  SimDeadWheelSpec,
  SimMotorSpec,
  SimOtosSpec,
  SimPinpointSpec,
  SimPose,
  SimServoParams,
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
// 엔코더 속도(모터 포트의 velocity, 데드휠 포함): 허브 펌웨어처럼 지난 50 ms 동안의 원시 틱 변화 × 20이다(encoderVelocity.ts:
// 늘 20 틱/s의 배수, 약 25 ms 늦음, 처음 50 ms는 시작 position부터 셈). 원시 틱은 하위 단계마다 기록한다. 모터 모델의
// RUN_USING_ENCODER 제어는 자기 연속 상태(ω)를 쓴다.
//
// 벽: 외곽 다각형의 꼭짓점이 벽 안쪽 면(±WALL_INNER_HALF)을 넘으면 평행 이동으로만 밀어낸다(회전은 그대로). 이번
// 하위 단계의 이동이 침투를 늘린 만큼만 되돌리므로 시작부터 벽에 걸쳐 있어도 튀지 않는다. 막혀도 모터 축(엔코더)은
// 계속 돌고, 실제로 움직인 만큼만 데드휠·Pinpoint 포드·OTOS가 잰다.
//
// 메커니즘 관절(3b, spec.joints가 있을 때): 관절 동역학(articulation.ts)을 하위 단계마다 같은 반복에서 푼다. 관절을 구동하는
// 모터는 DC 기어모터 + 허브 전력단 + 허브 펌웨어 제어(actuators.ts)로 돌고, 원시 틱은 관절 좌표(모터 출력축 각)에서 센다.
// 바퀴 모터는 지금처럼 motorModel.ts다(같은 OpMode에서 두 모터 모델의 RUN_TO_POSITION이 다르게 군다: 3c까지의 편차).
// 하위 단계 경계는 절대 1 ms 격자(0 ns부터)와 틱 경계다. 허브 제어 표본(10 ms 격자)이 그 격자 위에 있어 틱 간격이 달라도
// 같은 시각에 표본을 뜬다. 관절이 없는 세계는 지금처럼 구간을 균등하게 나눠 입력열이 바이트 그대로다.
// 관절 하위의 센서(IMU·OTOS·데드휠·Pinpoint)는 로봇 몸체에 붙은 것으로 계산한다(3b 한계, 렌더러가 경고한다).

export const SUBSTEP_NANOS = 1_000_000
// 한 번에 이보다 많은 하위 단계로 나누지 않는다(아주 긴 구간은 하위 단계가 1 ms보다 길어진다)
const MAX_SUBSTEPS = 10_000
// 침투가 이보다 적게 늘면 막힘으로 치지 않는다(부동 소수점 잡음)
const WALL_EPSILON = 1e-12

type Notice = { code: SimNoticeCode; params: Record<string, string> }

type DeadWheel = {
  spec: SimDeadWheelSpec
  // 원시 허브 틱(소수)과 허브 속도 측정
  raw: number
  hubVelocity: HubVelocityWindow
}

// 관절을 구동하는 모터 하나(동역학). 관절 좌표 φ(모터 출력축 각, 인스펙터 방향의 "앞")를 Articulation이 가진다.
type JointMotor = {
  // Articulation 좌표 순번
  coordinate: number
  dc: DcGearMotor
  // 출력축 1 rad의 엔코더 틱: 모터축 카운트 × 관절 동역학의 실제 감속비(actuatorData.ts jointEncoderTicksPerOutputRev)
  ticksPerRad: number
  controller: HubMotorController
  // 제어기가 보는 축 엔코더의 50 ms 창(포드와 포트를 함께 써도 펌웨어는 축 엔코더로 돈다고 가정한다)
  control: HubVelocityWindow
  // 이번 구간의 사이드카 출력
  out: MotorOutputs
  velocityPidf: [number, number, number, number]
  positionPidf: [number, number, number, number]
  // 이번 하위 단계의 전력단("앞" 부호)
  stage: PowerStage
  // 원시 허브 틱(소수)
  raw: number
  // 단자 전류 크기(A)
  current: number
}

// 서보·CR 서보로 구동하는 관절 하나(관절 좌표 z = q)
type JointServo = {
  coordinate: number
  device: string
  // 서보 출력축 rad당 관절 rad 또는 m(부호 포함)
  ratio: number
  params: SimServoParams
  continuous: boolean
  // 편집 자세의 펄스(위치 서보)와 +펄스의 관절 방향(servoCommand)
  zeroPulseUs: number
  direction: 1 | -1
  command: ServoCommand
}

type Motor = {
  spec: SimMotorSpec
  // 구동계 모터(운동학). 관절 모터면 null
  model: MotorModel | null
  // 관절 모터(동역학). 구동계 모터면 null
  joint: JointMotor | null
  // 허브 각 → 바퀴 앞 굴림 부호(관절 모터는 허브 각 → φ)
  forwardSign: number
  // 같은 장치 이름의 데드휠(실제 배선: 그 포트의 엔코더는 포드다)
  pod: DeadWheel | null
  // 축 엔코더의 허브 속도 측정(포드와 포트를 함께 쓰면 포드의 것을 보내므로 없다)
  hubVelocity: HubVelocityWindow | null
  // RUN_TO_POSITION의 원시 목표를 만드는 기준(축 틱). 포드와 포트를 함께 쓰지 않으면 encoderOffset 그대로다.
  shaftOffset: number
  // 지난 구간에 본 사이드카의 리셋 횟수(encoderResets)
  lastEncoderResets: number
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
  // 전원을 켤 때(실행 시작, 로봇 시작 자세)의 센서 자세(필드)
  sensorAtStart: Pose2
  // 앞 틱의 센서 자세(필드)와 원시 속도(가속도)
  sensorAtTick: Pose2
  velocity: { vx: number; vy: number; vh: number }
}

type State = Map<string, Map<string, number | boolean>>

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

// 장치 이름으로 출력을 찾는다(자기 속성만: 이름이 '__proto__'여도 프로토타입을 읽지 않게)
function own(outputs: Record<string, DeviceValues>, device: string): DeviceValues | undefined {
  return Object.prototype.hasOwnProperty.call(outputs, device) ? outputs[device] : undefined
}

// src/main/sidecar/world.ts의 SimWorld를 구조적으로 구현한다(shared는 main을 가져오지 않는다. 형식 확인은 그 파일의
// kinematicWorld가 한다).
export class KinematicWorld {
  private readonly spec: WorldSpec
  private readonly drivetrain: Drivetrain
  private readonly motors: Motor[]
  private readonly deadWheels: DeadWheel[]
  private readonly pinpoints: Pinpoint[]
  private readonly otos: Otos[]
  // 바퀴 i를 구동하는 모터의 motors 순번(spec.wheels 순서), 없으면 −1
  private readonly wheelMotors: number[]
  // 메커니즘 관절(없으면 null: 운동학 2단계와 같은 경로)
  private readonly articulation: Articulation | null
  private readonly servos: JointServo[]
  // 다음 허브 제어 표본 시각(ns)
  private nextSample = 0
  // 관절 계산이 실패해 관절을 멈췄다
  private jointsFailed = false

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
    this.deadWheels = spec.deadWheels.map((d) => ({
      spec: d,
      raw: 0,
      hubVelocity: new HubVelocityWindow()
    }))
    const podByName = new Map<string, DeadWheel>()
    for (const pod of this.deadWheels) podByName.set(pod.spec.device, pod)
    this.articulation = spec.joints.length > 0 ? new Articulation(spec.joints) : null
    // 관절 모터 장치 → (좌표, 기어모터 값). parseWorldSpec가 한 모터를 한 관절에만 두고 바퀴와 겹치지 않음을 확인한다.
    const jointMotors = new Map<string, { coordinate: number; dc: DcGearMotor }>()
    this.servos = []
    this.articulation?.coordinates.forEach((coordinate, index) => {
      const drive = spec.joints[coordinate.joint].drive
      if (coordinate.kind === 'motor' && drive.kind === 'motor') {
        const dc = new DcGearMotor(drive.params)
        for (const device of drive.devices) jointMotors.set(device, { coordinate: index, dc })
      } else if (drive.kind === 'servo' || drive.kind === 'crServo') {
        this.servos.push({
          coordinate: index,
          device: drive.device,
          ratio: drive.ratio,
          params: drive.params,
          continuous: drive.kind === 'crServo',
          zeroPulseUs: drive.kind === 'servo' ? drive.zeroPulseUs : SERVO_CENTER_US,
          direction: drive.direction,
          command: { kind: 'limp' }
        })
      }
    })
    this.motors = spec.motors.map((m) => {
      const pod = podByName.get(m.device) ?? null
      const base = {
        spec: m,
        forwardSign: rotationSign(motorType(m.modelTag)) * m.directionSign,
        pod,
        hubVelocity: pod ? null : new HubVelocityWindow(),
        shaftOffset: 0,
        lastEncoderResets: 0
      }
      const driven = jointMotors.get(m.device)
      if (!driven) return { ...base, model: new MotorModel(m.modelTag, m.gearbox), joint: null }
      const control = base.hubVelocity ?? new HubVelocityWindow()
      return {
        ...base,
        model: null,
        joint: {
          coordinate: driven.coordinate,
          dc: driven.dc,
          ticksPerRad: jointEncoderTicksPerOutputRev(m.modelTag, driven.dc.gearbox) / (2 * Math.PI),
          controller: new HubMotorController(),
          control,
          out: readMotorOutputs(undefined),
          velocityPidf: DEFAULT_VELOCITY_PIDF,
          positionPidf: DEFAULT_POSITION_PIDF,
          stage: FLOAT,
          raw: 0,
          current: 0
        }
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
    if (dtNanos > 0) this.integrate(this.tPrev as number, dtNanos)
    if (first) {
      this.recordEncoders(tNanos)
      this.nextSample = Math.ceil(tNanos / HUB_CONTROL_PERIOD_NANOS) * HUB_CONTROL_PERIOD_NANOS
    }
    if (dtNanos > 0 || first) this.tPrev = tNanos
    this.checkSharedPorts(outputs)
    this.outputsPrev = outputs
    return this.changed(this.inputs(Math.max(0, dtNanos) / 1e9, yawBefore), first)
  }

  pose(): SimPose {
    const pose: SimPose = {
      x: this.poseNow.x,
      y: this.poseNow.y,
      yaw: this.poseNow.yaw,
      blocked: this.blocked
    }
    if (this.articulation) pose.joints = this.articulation.q()
    return pose
  }

  drainNotices(): Notice[] {
    return this.notices.splice(0, this.notices.length)
  }

  // ---- 적분 ----

  // [tStart, tStart + dtNanos] 구간
  private integrate(tStart: number, dtNanos: number): void {
    const voltage = this.spec.batteryVoltage
    const commands: (MotorCommand | null)[] = this.motors.map((motor) => {
      const values = own(this.outputsPrev, motor.spec.device)
      const out = readMotorOutputs(values)
      // 포드와 포트를 함께 쓰면 사이드카의 encoderOffset은 포드 틱이다. 시뮬레이터는 축 엔코더로 제어하므로 리셋을
      // 본 때(사이드카의 리셋 횟수가 바뀐 때)의 축 틱을 기준으로 삼는다. 포드가 그대로면 encoderOffset도 그대로이고,
      // 한 루프에서 리셋 → RUN_TO_POSITION을 하면 틱 경계가 STOP_AND_RESET_ENCODER 모드를 보지 못할 수 있다.
      if (motor.pod) {
        if (out.encoderResets !== motor.lastEncoderResets)
          motor.shaftOffset = Math.floor(rawOf(motor))
      } else {
        motor.shaftOffset = out.encoderOffset
      }
      motor.lastEncoderResets = out.encoderResets
      if (motor.joint) {
        motor.joint.out = out
        motor.joint.velocityPidf = readPidf(values, 'velocityPidf', DEFAULT_VELOCITY_PIDF)
        motor.joint.positionPidf = readPidf(values, 'positionPidf', DEFAULT_POSITION_PIDF)
        return null
      }
      return (motor.model as MotorModel).command(out, voltage, motor.shaftOffset)
    })
    for (const servo of this.servos)
      servo.command = servoCommand(
        own(this.outputsPrev, servo.device),
        servo.params,
        servo.continuous,
        servo.zeroPulseUs,
        servo.direction
      )
    const { starts, ends, hs } = this.articulation
      ? gridSubsteps(tStart, dtNanos)
      : uniformSubsteps(tStart, dtNanos)
    const rolls = new Array<number>(this.spec.wheels.length).fill(0)
    const angles = new Array<number>(this.motors.length).fill(0)
    for (let s = 0; s < hs.length; s++) {
      const h = hs[s]
      if (this.articulation) this.jointSubstep(this.articulation, starts[s], h, voltage)
      this.motors.forEach((motor, i) => {
        const command = commands[i]
        if (motor.model && command) angles[i] = motor.model.advance(command, h)
      })
      this.spec.wheels.forEach((wheel, i) => {
        const index = this.wheelMotors[i]
        rolls[i] =
          index < 0
            ? 0
            : ((angles[index] * this.motors[index].forwardSign) / wheel.gearRatio) * wheel.radius
      })
      this.moveRobot(this.drivetrain.twist(rolls))
      this.recordEncoders(ends[s])
    }
    if (this.articulation) this.jointCurrents(this.articulation, voltage)
  }

  // ---- 관절 ----

  // 하위 단계 하나: 표본 시각이면 허브 제어기를 돌리고, 전력단·서보 명령으로 관절 동역학을 h만큼 푼 뒤 원시 틱을 센다
  private jointSubstep(articulation: Articulation, t: number, h: number, voltage: number): void {
    if (t >= this.nextSample) {
      this.nextSample = (Math.floor(t / HUB_CONTROL_PERIOD_NANOS) + 1) * HUB_CONTROL_PERIOD_NANOS
      for (const motor of this.motors) {
        const jm = motor.joint
        if (!jm) continue
        jm.controller.sample({
          out: jm.out,
          velocityPidf: jm.velocityPidf,
          positionPidf: jm.positionPidf,
          position: Math.floor(jm.raw),
          velocity: jm.control.ticksPerSecond(),
          rawTarget:
            jm.out.targetPosition === null ? null : jm.out.targetPosition + motor.shaftOffset
        })
      }
    }
    for (const motor of this.motors) {
      const jm = motor.joint
      if (!jm) continue
      const stage = jm.controller.stage(jm.out)
      jm.stage =
        stage.kind === 'duty' ? { kind: 'duty', duty: stage.duty * motor.forwardSign } : stage
    }
    if (this.jointsFailed) return
    try {
      articulation.step(h, (z, v) => this.driveForces(z, v, voltage))
    } catch (error) {
      // 수치가 터지면(Articulation은 상태를 바꾸기 전에 던진다) 관절을 그 자리에 멈추고 한 번 알린다. 구동계는 계속 돈다.
      this.jointsFailed = true
      articulation.v.fill(0)
      this.notify('worldError', { detail: error instanceof Error ? error.message : String(error) })
      return
    }
    for (const motor of this.motors) {
      const jm = motor.joint
      if (jm) jm.raw = motor.forwardSign * jm.ticksPerRad * articulation.z[jm.coordinate]
    }
  }

  // 관절 좌표마다 구동 힘(모터: 전기 토크 + 기어 손실·마찰 상자, 서보: PD·포화·풀림)
  private driveForces(z: readonly number[], v: readonly number[], voltage: number): DriveForces {
    const m = z.length
    const forces: DriveForces = {
      force: new Array<number>(m).fill(0),
      damping: new Array<number>(m).fill(0),
      stiffness: new Array<number>(m).fill(0),
      boxLo: new Array<number>(m).fill(0),
      boxHi: new Array<number>(m).fill(0),
      regions: ''
    }
    for (const motor of this.motors) {
      const jm = motor.joint
      if (!jm) continue
      const c = jm.coordinate
      const dc = jm.dc
      const g = dc.gearbox
      const omega = v[c]
      const terms = dc.terms(jm.stage, voltage, omega)
      forces.force[c] += terms.force
      forces.damping[c] += terms.damping + g * g * dc.viscous
      // 모터가 미는 쪽으로 움직임을 막는 기어 손실(1 − η)·|τ|(한쪽 상자)와 모터축 쿨롱 마찰 G·τ_c(양쪽)
      const torque = terms.force - terms.damping * omega
      const loss = (1 - dc.efficiency) * Math.abs(torque)
      const coulomb = g * dc.coulomb
      forces.boxLo[c] -= coulomb + (torque > 0 ? loss : 0)
      forces.boxHi[c] += coulomb + (torque < 0 ? loss : 0)
      forces.regions += terms.region
    }
    for (const servo of this.servos) {
      const c = servo.coordinate
      const r = servo.ratio
      const terms = servoTerms(servo.command, servo.params, z[c] / r, v[c] / r)
      forces.force[c] += terms.force / r
      forces.damping[c] += terms.damping / (r * r)
      forces.stiffness[c] += terms.stiffness / (r * r)
      forces.boxLo[c] -= terms.friction / Math.abs(r)
      forces.boxHi[c] += terms.friction / Math.abs(r)
      forces.regions += terms.region
    }
    return forces
  }

  // 구간 끝의 단자 전류(크기). 허브 전류 측정(VNH5050 전류 감지)은 크기만 보고한다고 본다(가정).
  private jointCurrents(articulation: Articulation, voltage: number): void {
    for (const motor of this.motors) {
      const jm = motor.joint
      if (!jm) continue
      const current = jm.dc.current(jm.stage, voltage, articulation.v[jm.coordinate])
      jm.current = Math.abs(current)
    }
  }

  // 하위 단계 끝(과 첫 틱)의 원시 엔코더 틱을 허브 속도 측정에 기록한다
  private recordEncoders(tNanos: number): void {
    for (const motor of this.motors) {
      const raw = rawOf(motor)
      motor.hubVelocity?.record(tNanos, raw)
      // 포드와 포트를 함께 쓰는 관절 모터는 제어기 창을 따로 둔다(아니면 hubVelocity와 같은 창이다)
      if (motor.joint && motor.joint.control !== motor.hubVelocity)
        motor.joint.control.record(tNanos, raw)
    }
    for (const pod of this.deadWheels) pod.hubVelocity.record(tNanos, pod.raw)
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
  // 팀이 해상도(ticksPerMm)를 아직 정하지 않았으면 x·y는 그대로 둔다(heading은 내장 IMU라 inputs가 따로 보낸다).
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
    const put = (device: string, key: string, value: number | boolean): void => {
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
      // 포드와 포트를 함께 쓰면 그 포트의 엔코더는 포드다(아래)
      if (motor.hubVelocity) {
        put(motor.spec.device, 'position', Math.floor(rawOf(motor)))
        put(motor.spec.device, 'velocity', motor.hubVelocity.ticksPerSecond())
      }
      // 관절 모터만 단자 전류를 보낸다(구동계 모터 모델에는 토크가 없다)
      if (motor.joint) put(motor.spec.device, 'current', motor.joint.current)
    }
    for (const pod of this.deadWheels) {
      put(pod.spec.device, 'position', Math.floor(pod.raw))
      put(pod.spec.device, 'velocity', pod.hubVelocity.ticksPerSecond())
    }

    // 리밋 스위치: 그 끝에서 within 안이면 눌림. touch는 pressed true, digital은 state false(풀업 핀이 LOW)
    if (this.articulation) {
      const q = this.articulation.q()
      this.spec.joints.forEach((joint, i) => {
        const limits = joint.limits
        if (!limits) return
        for (const s of joint.switches) {
          const pressed =
            s.at === 'lower' ? q[i] <= limits.lower + s.within : q[i] >= limits.upper - s.within
          if (s.kind === 'touch') put(s.device, 'pressed', pressed)
          else put(s.device, 'state', !pressed)
        }
      })
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
      const entries: [string, number | boolean][] = []
      for (const [key, value] of values) {
        if (typeof value === 'number' && !Number.isFinite(value)) continue
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

// 모터의 원시 허브 틱(소수): 구동계 모터는 운동학 모델, 관절 모터는 관절 좌표에서 센 값
function rawOf(motor: Motor): number {
  return motor.model ? motor.model.raw : (motor.joint as JointMotor).raw
}

type Substeps = { starts: number[]; ends: number[]; hs: number[] }

// 관절이 없는 세계: 구간을 1 ms 이하로 균등하게 나눈다(2단계와 같은 연산이라 입력열이 바이트 그대로다)
function uniformSubsteps(tStart: number, dtNanos: number): Substeps {
  const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(dtNanos / SUBSTEP_NANOS)))
  const h = dtNanos / 1e9 / steps
  const starts: number[] = []
  const ends: number[] = []
  const hs: number[] = []
  for (let s = 0; s < steps; s++) {
    starts.push(s === 0 ? tStart : ends[s - 1])
    ends.push(s + 1 === steps ? tStart + dtNanos : tStart + (dtNanos * (s + 1)) / steps)
    hs.push(h)
  }
  return { starts, ends, hs }
}

// 관절이 있는 세계: 0 ns부터의 절대 격자(1 ms, 허브 제어 표본 10 ms를 포함)와 구간 끝에서 끊는다. 아주 긴 구간은
// MAX_SUBSTEPS를 넘지 않게 격자를 10배씩 넓힌다(그때 제어 표본은 격자를 지난 첫 하위 단계에서 뜬다).
function gridSubsteps(tStart: number, dtNanos: number): Substeps {
  const tEnd = tStart + dtNanos
  let cell = SUBSTEP_NANOS
  while (dtNanos / cell > MAX_SUBSTEPS - 2) cell *= 10
  const starts: number[] = [tStart]
  const ends: number[] = []
  for (let t = (Math.floor(tStart / cell) + 1) * cell; t < tEnd; t += cell) {
    ends.push(t)
    starts.push(t)
  }
  ends.push(tEnd)
  return { starts, ends, hs: starts.map((t, s) => (ends[s] - t) / 1e9) }
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
