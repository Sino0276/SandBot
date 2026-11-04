import type { DeviceValues } from '../sidecarProtocol'
import { motorType, rotationSign, ticksPerOutputRev } from './motorTypes'
import { GRAVITY } from './physics'
import { testChassis, testMotorParams } from './testkit'
import { DEFAULT_WHEEL_FRICTION, wheelSpinInertia } from './wheelData'
import { PhysicsWorld, type PhysicsWorldOptions } from './world'
import {
  WORLD_SPEC_VERSION,
  type Pose2,
  type SimMotorParams,
  type SimPose,
  type SimWheelSpec,
  type WheelKind,
  type WorldSpec
} from './worldSpec'

// 구동계 동역학(3c) 시험의 기준 로봇과 실행 도구(시험·맞춤 전용, 제품 코드는 쓰지 않는다). 기준 로봇: 13.6 kg(3a
// DEFAULT_ROBOT_MASS), 18 in 정사각, goBILDA GripForce 104 mm 메카넘, goBILDA 5203 19.2:1(312 RPM), μ 종류 기본.

export const TICK = 5_000_000
export const TAG = 'goBILDA5202SeriesMotor'
export const RADIUS = 0.052
export const HALF = 0.2286
// 바퀴 중심(앞뒤 ±LX, 좌우 ±LY)
export const LX = 0.15
export const LY = 0.16
export const VOLTS = 12
export const WEIGHT = 13.6 * GRAVITY
export const ZERO = { x: 0, y: 0, z: 0 }

export type Robot = {
  gearbox?: number
  mass?: number
  comHeight?: number
  comX?: number
  kind?: WheelKind
  // 겉보기 μ(바퀴 설정), 없으면 종류 기본
  friction?: number
  spinInertia?: number
  params?: (gearbox: number) => SimMotorParams
  start?: Pose2
}

export const datasheet = (gearbox: number): SimMotorParams => testMotorParams(TAG, gearbox)
// 이상 모터 판: 효율 1, 마찰 0, 무부하 전류 0(점성 0) — 감쇠가 역기전력 G²·Kt·Ke/R 하나다
export const ideal = (gearbox: number): SimMotorParams => ({
  ...datasheet(gearbox),
  efficiency: 1,
  backdriveFriction: 0,
  freeCurrent: 0
})

export const DEVICES = ['fl', 'fr', 'bl', 'br'] as const
export type Device = (typeof DEVICES)[number]
// 왼쪽 모터는 인스펙터 REVERSE(world.test.ts와 같은 배선)
export const DIRECTION: Record<Device, 1 | -1> = { fl: -1, fr: 1, bl: -1, br: 1 }
export const POSITION: Record<Device, { x: number; y: number }> = {
  fl: { x: LX, y: LY },
  fr: { x: LX, y: -LY },
  bl: { x: -LX, y: LY },
  br: { x: -LX, y: -LY }
}

export function robotSpec(robot: Robot = {}, change: Partial<WorldSpec> = {}): WorldSpec {
  const gearbox = robot.gearbox ?? 19.2
  const kind = robot.kind ?? 'mecanum'
  const params = (robot.params ?? datasheet)(gearbox)
  const body = testChassis(robot.mass ?? 13.6)
  body.centerOfMass = { x: robot.comX ?? 0, y: 0, z: robot.comHeight ?? 0.1 }
  const wheel = (device: Device): SimWheelSpec => {
    const p = POSITION[device]
    return {
      position: p,
      angle: 0,
      kind,
      rollers: kind === 'mecanum' ? (p.x > 0 === p.y > 0 ? 'flbr' : 'frbl') : null,
      radius: RADIUS,
      gearRatio: 1,
      motor: device,
      spinInertia: robot.spinInertia ?? wheelSpinInertia(kind, RADIUS, null),
      friction: robot.friction ?? DEFAULT_WHEEL_FRICTION[kind]
    }
  }
  return {
    version: WORLD_SPEC_VERSION,
    robot: {
      start: robot.start ?? { x: -1.2, y: 0, yaw: 0 },
      footprint: [
        { x: HALF, y: HALF },
        { x: -HALF, y: HALF },
        { x: -HALF, y: -HALF },
        { x: HALF, y: -HALF }
      ],
      body
    },
    batteryVoltage: VOLTS,
    hubs: ['Control Hub'],
    motors: DEVICES.map((device) => ({
      device,
      modelTag: TAG,
      gearbox,
      directionSign: DIRECTION[device],
      params
    })),
    wheels: DEVICES.map(wheel),
    deadWheels: [],
    pinpoints: [],
    otos: [],
    imus: [{ device: 'imu' }],
    joints: [],
    ...change
  }
}

export const HUB_SIGN = rotationSign(motorType(TAG))

// 팀 코드의 setPower(인스펙터 방향 그대로) → 사이드카 허브 출력
export function motorOut(device: Device, power: number, change: DeviceValues = {}): DeviceValues {
  return {
    mode: 'RUN_WITHOUT_ENCODER',
    power: power * HUB_SIGN * DIRECTION[device],
    velocity: null,
    enabled: true,
    zeroPower: 'BRAKE',
    targetPosition: null,
    encoderOffset: 0,
    ...change
  }
}

export type Powers = Partial<Record<Device, number>>
// gm0 메카넘: y 앞, x 오른쪽, rx 시계 방향
export const mecanum = (y: number, x: number, rx: number): Powers => ({
  fl: y + x + rx,
  bl: y - x + rx,
  fr: y - x - rx,
  br: y + x - rx
})

export function outputs(
  powers: Powers,
  change: DeviceValues = {},
  extra: Record<string, DeviceValues> = {}
): Record<string, DeviceValues> {
  const out: Record<string, DeviceValues> = {}
  for (const device of DEVICES) out[device] = motorOut(device, powers[device] ?? 0, change)
  return { ...out, ...extra }
}

// 세계를 틱으로 돌린다(k는 이어지는 틱 번호). 틱마다 자세·입력을 모은다.
export class Runner {
  readonly world: PhysicsWorld
  k = 0
  readonly poses: SimPose[] = []
  readonly inputs: Record<string, DeviceValues>[] = []
  private readonly state: Record<string, DeviceValues> = {}

  constructor(
    spec: WorldSpec,
    options: PhysicsWorldOptions = {},
    readonly tick = TICK
  ) {
    this.world = new PhysicsWorld(spec, options)
  }

  run(seconds: number, out: (k: number) => Record<string, DeviceValues>): this {
    const last = this.k + Math.round((seconds * 1e9) / this.tick)
    for (; this.k < last; this.k++) {
      const input = this.world.step(this.k * this.tick, out(this.k))
      this.inputs.push(input)
      for (const [device, values] of Object.entries(input))
        this.state[device] = { ...this.state[device], ...values }
      this.poses.push(this.world.pose())
    }
    return this
  }

  value(device: string, key: string): number {
    return this.state[device]?.[key] as number
  }

  pose(): SimPose {
    return this.poses[this.poses.length - 1]
  }

  // 틱 a·b 사이 필드 축(또는 각 direction 방향) 평균 속도(m/s)
  speed(a: number, b: number, axis: 'x' | 'y' | number = 'x'): number {
    const angle = axis === 'x' ? 0 : axis === 'y' ? Math.PI / 2 : axis
    const dx = this.poses[b].x - this.poses[a].x
    const dy = this.poses[b].y - this.poses[a].y
    return (dx * Math.cos(angle) + dy * Math.sin(angle)) / ((b - a) * (this.tick / 1e9))
  }
}

export const perRad = (gearbox: number): number =>
  ticksPerOutputRev(motorType(TAG), gearbox) / (2 * Math.PI)
export const forwardSign = (device: Device): number => HUB_SIGN * DIRECTION[device]

// ---- Pedro Pathing 튜너 절차(spec-3c §1.3 맞춤 절차) ----

// Pedro 2.1.2 기본값을 낸 것으로 보는 로봇(data §3, spec-3c §1.3): 10.65 kg, 13.7:1(435 RPM), GripForce 104 mm, 18 in 정사각,
// 무게중심 높이 0.1 m, μ 기본. 2 s 동안 약 3.6 m를 가므로 필드 구석(−1.45, −1.45)에서 대각선(45°)으로 달린다(벽까지 4.1 m).
export const PEDRO_ROBOT: Robot = { gearbox: 13.7, mass: 10.65 }
const CORNER = -1.45
const DIAGONAL = Math.PI / 4

function pedroRun(axis: 'x' | 'y', options: PhysicsWorldOptions): { r: Runner; command: Powers } {
  // 앞(x)은 로봇 요 45°, 왼쪽 옆걸음(y)은 요 −45°라 둘 다 필드 대각선으로 간다
  const yaw = axis === 'x' ? DIAGONAL : -DIAGONAL
  const spec = robotSpec({ ...PEDRO_ROBOT, start: { x: CORNER, y: CORNER, yaw } })
  return {
    r: new Runner(spec, options),
    command: axis === 'x' ? mecanum(1, 0, 0) : mecanum(0, -1, 0)
  }
}

const DT = TICK / 1e9

// power 1로 2 s 달린 끝 속도(m/s, 마지막 50 ms 평균). axis: 'x'면 앞, 'y'면 왼쪽 옆걸음
export function pedroVelocity(axis: 'x' | 'y', options: PhysicsWorldOptions = {}): number {
  const { r, command } = pedroRun(axis, options)
  r.run(2, () => outputs(command))
  if (r.poses.some((p) => p.blocked)) throw new Error('robot hit a wall')
  return r.speed(r.poses.length - 11, r.poses.length - 1, DIAGONAL)
}

// power 1로 출발해 0.762 m/s(30 in/s)를 넘으면 power 0 FLOAT로 끊고, 0.0254 m/s(1 in/s)까지의 평균 감속(m/s², 양수)
export function pedroDeceleration(axis: 'x' | 'y', options: PhysicsWorldOptions = {}): number {
  const { r, command } = pedroRun(axis, options)
  let cut = -1
  let cutSpeed = 0
  r.run(DT, () => outputs(command))
  for (let k = 1; k < 2000; k++) {
    r.run(DT, () => (cut < 0 ? outputs(command) : outputs({}, { zeroPower: 'FLOAT' })))
    const speed = r.speed(k - 1, k, DIAGONAL)
    if (cut < 0) {
      if (speed > 0.762) {
        cut = k
        cutSpeed = speed
      }
    } else if (speed <= 0.0254) {
      return (cutSpeed - speed) / ((k - cut) * DT)
    }
  }
  throw new Error('robot did not stop')
}
