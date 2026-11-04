import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { WALL_INNER_HALF } from './field'
import { twistBetween } from './drivetrain'
import { motorType, rotationSign, ticksPerOutputRev } from './motorTypes'
import { DcGearMotor } from './actuators'
import { GRAVITY } from './physics'
import { TEST_CHASSIS_MASS, testChassis, testMotorParams, testWheelPhysics } from './testkit'
import { ROLLING_RESISTANCE } from './wheelData'
import { PhysicsWorld } from './world'
import {
  WORLD_SPEC_VERSION,
  type SimMotorSpec,
  type SimWheelSpec,
  type WorldSpec
} from './worldSpec'

const TICK = 5_000_000
const GOBILDA = 'goBILDA5202SeriesMotor'
const GEARBOX = 19.2
const RADIUS = 0.052
const LX = 0.15
const LY = 0.16
const HALF = 0.2286
const VOLTS = 12

// 모터 이름 → 팀 코드의 setPower 값
type Drive = Partial<Record<'fl' | 'fr' | 'bl' | 'br', number>>

function motorSpec(device: string, directionSign: 1 | -1): SimMotorSpec {
  return {
    device,
    modelTag: GOBILDA,
    gearbox: GEARBOX,
    directionSign,
    params: testMotorParams(GOBILDA, GEARBOX)
  }
}

function mecanumWheel(device: string, x: number, y: number): SimWheelSpec {
  return {
    position: { x, y },
    angle: 0,
    kind: 'mecanum',
    rollers: x > 0 === y > 0 ? 'flbr' : 'frbl',
    radius: RADIUS,
    gearRatio: 1,
    motor: device,
    ...testWheelPhysics('mecanum', RADIUS)
  }
}

// 메카넘 로봇(왼쪽 모터는 인스펙터 REVERSE): 18 in 외곽, IMU, Control Hub
function mecanumSpec(change: Partial<WorldSpec> = {}): WorldSpec {
  return {
    version: WORLD_SPEC_VERSION,
    robot: {
      start: { x: 0, y: 0, yaw: 0 },
      footprint: [
        { x: HALF, y: HALF },
        { x: -HALF, y: HALF },
        { x: -HALF, y: -HALF },
        { x: HALF, y: -HALF }
      ],
      body: testChassis()
    },
    batteryVoltage: VOLTS,
    hubs: ['Control Hub'],
    motors: [motorSpec('fl', -1), motorSpec('fr', 1), motorSpec('bl', -1), motorSpec('br', 1)],
    wheels: [
      mecanumWheel('fl', LX, LY),
      mecanumWheel('fr', LX, -LY),
      mecanumWheel('bl', -LX, LY),
      mecanumWheel('br', -LX, -LY)
    ],
    deadWheels: [],
    pinpoints: [],
    otos: [],
    imus: [{ device: 'imu' }],
    joints: [],
    ...change
  }
}

// 사이드카가 보내는 모터 출력(엔코더 없음). apiPower는 팀 코드의 setPower 값이고, 허브 power는 SDK처럼
// 형식 회전 방향과 (팀이 쓴) 방향을 적용한 값이다.
function motorOut(
  apiPower: number,
  directionSign: number,
  change: DeviceValues = {}
): DeviceValues {
  const hub = apiPower * rotationSign(motorType(GOBILDA)) * directionSign
  return {
    apiPower,
    motorType: GOBILDA,
    mode: 'RUN_WITHOUT_ENCODER',
    power: hub,
    velocity: null,
    enabled: true,
    zeroPower: 'BRAKE',
    targetPosition: null,
    targetTolerance: 5,
    encoderOffset: 0,
    ...change
  }
}

// 메카넘 팀 코드(gm0): y 앞, x 오른쪽, rx 시계 방향 회전
function mecanum(y: number, x: number, rx: number): Drive {
  return { fl: y + x + rx, bl: y - x + rx, fr: y - x - rx, br: y + x - rx }
}

function driveOutputs(
  spec: WorldSpec,
  drive: Drive,
  extra: Record<string, DeviceValues> = {}
): Record<string, DeviceValues> {
  const out: Record<string, DeviceValues> = {}
  for (const m of spec.motors)
    out[m.device] = motorOut(drive[m.device as 'fl'] ?? 0, m.directionSign)
  return { ...out, ...extra }
}

type Run = { world: PhysicsWorld; inputs: Record<string, DeviceValues>[]; t: number }

// 틱 k마다 step(k·5 ms, outputs(k)). 첫 호출(t = 0)은 상태만 만든다.
function run(
  spec: WorldSpec,
  seconds: number,
  outputs: (k: number) => Record<string, DeviceValues>,
  from?: Run
): Run {
  const world = from?.world ?? new PhysicsWorld(spec)
  const inputs = from?.inputs ?? []
  const first = from ? Math.round(from.t / TICK) + 1 : 0
  const last = first + Math.round((seconds * 1e9) / TICK)
  for (let k = first; k < last; k++) inputs.push(world.step(k * TICK, outputs(k)))
  return { world, inputs, t: (last - 1) * TICK }
}

// 입력열을 장치·키마다 마지막 값으로 합친다(사이드카가 보는 값)
function latest(inputs: Record<string, DeviceValues>[]): Record<string, DeviceValues> {
  const state: Record<string, DeviceValues> = {}
  for (const step of inputs)
    for (const [device, values] of Object.entries(step))
      state[device] = { ...state[device], ...values }
  return state
}

const num = (v: unknown): number => v as number

// 데이터시트 기어모터(world.ts가 바퀴 모터에 쓰는 것과 같은 값)
const DC = new DcGearMotor(testMotorParams(GOBILDA, GEARBOX))
// 바퀴 하나의 정적 하중(섀시 무게중심이 가운데: 무게의 1/4)
const WHEEL_LOAD = (TEST_CHASSIS_MASS * GRAVITY) / 4

// 듀티 d·전압 V로 직진하는 정상 상태의 출력축 각속도(rad/s). 바퀴 좌표의 힘이 0인 점이다: 모터가 밀면 효율 상자가 차서
// 출력 토크가 η·G·Kt·(dV − Ke·G·ω)/R이고, 모터축 쿨롱 G·τ_c·점성 G²·b·ω·굴림 저항 c_rr·N·r이 그만큼을 먹는다(actuators.ts
// DcGearMotor, contact.ts). 데이터시트 무부하 속도는 d = 1·12 V·굴림 저항 0에서 정확히 ω_free다(점성을 무부하 전류에 맞춤).
function steadyRate(duty: number, volts: number, rolling = ROLLING_RESISTANCE): number {
  const g = DC.gearbox
  const k = (DC.efficiency * g * DC.torqueConstant) / DC.resistance
  const drive = k * duty * volts - g * DC.coulomb - rolling * WHEEL_LOAD * RADIUS
  return drive / (k * DC.backEmfConstant * g + g * g * DC.viscous)
}

describe('PhysicsWorld 메카넘', () => {
  it('첫 호출은 적분하지 않고 모든 입력, 그 뒤는 바뀐 키만', () => {
    const spec = mecanumSpec()
    const world = new PhysicsWorld(spec)
    const first = world.step(0, driveOutputs(spec, mecanum(1, 0, 0)))
    expect(Object.keys(first)).toEqual(['Control Hub', 'fl', 'fr', 'bl', 'br', 'imu'])
    expect(first['Control Hub']).toEqual({ voltage: VOLTS })
    // 모든 모터가 단자 전류를 보낸다(3c: 바퀴 모터도 동역학 기어모터)
    expect(first.fl).toEqual({ position: 0, velocity: 0, current: 0 })
    expect(first.imu).toEqual({ yaw: 0, pitch: 0, roll: 0, yawRate: 0, pitchRate: 0, rollRate: 0 })
    expect(world.pose()).toEqual({ x: 0, y: 0, yaw: 0, blocked: false })
    // 출력이 바뀌지 않고 아무것도 움직이지 않으면 보낼 것이 없다
    const still = new PhysicsWorld(spec)
    still.step(0, driveOutputs(spec, {}))
    expect(still.step(TICK, driveOutputs(spec, {}))).toEqual({})
    // 앞 틱의 출력(앞으로)으로 적분했으므로 모터 값만 바뀐다(허브·IMU 값은 그대로)
    world.step(TICK, driveOutputs(spec, mecanum(1, 0, 0)))
    const next = world.step(2 * TICK, driveOutputs(spec, {}))
    // 대칭 로봇이라 IMU는 반올림 잡음(요 속도 1e-12 rad/s 아래)만 바뀔 수 있다
    expect(Object.keys(next).filter((key) => key !== 'imu')).toEqual(['fl', 'fr', 'bl', 'br'])
    if (next.imu) expect(Math.abs(num(next.imu.yawRate ?? 0))).toBeLessThan(1e-12)
    for (const [device, values] of Object.entries(next)) {
      if (device === 'imu') continue
      for (const key of ['position', 'velocity'] as const)
        if (values[key] !== undefined) expect(Number.isInteger(values[key])).toBe(true)
      expect(num(values.current)).toBeGreaterThan(0)
    }
  })

  it('앞으로: 표준 메카넘 순방향, 엔코더는 허브 부호(팀 코드에서 앞으로 갈 때 는다)', () => {
    const spec = mecanumSpec()
    const r = run(spec, 1, () => driveOutputs(spec, mecanum(0.6, 0, 0)))
    const pose = r.world.pose()
    expect(pose.x).toBeGreaterThan(0.5)
    // 대칭 로봇: 옆·요는 반올림 잡음뿐
    expect(Math.abs(pose.y)).toBeLessThan(1e-9)
    expect(Math.abs(pose.yaw)).toBeLessThan(1e-9)
    const state = latest(r.inputs)
    // goBILDA(CCW) FORWARD(오른쪽): 허브 −, REVERSE(왼쪽): 허브 + → 팀 코드는 둘 다 +
    expect(num(state.fr.position)).toBeLessThan(0)
    expect(num(state.br.position)).toBeLessThan(0)
    expect(num(state.fl.position)).toBeGreaterThan(0)
    expect(num(state.bl.position)).toBeGreaterThan(0)
    // 바퀴 굴림 ≥ 로봇 이동: power 0.6 출발은 바퀴 힘(≈ 0.6·τ_s/r)이 견인 한계 μ·N보다 커서 처음에 헛돌고, 붙은 뒤에는
    // 미끄럼이 0이다(정확한 쿨롱 마찰). 헛돈 거리는 몇 cm 안이다.
    const perRev = ticksPerOutputRev(motorType(GOBILDA), GEARBOX)
    const rolled = (Math.abs(num(state.fr.position)) / perRev) * 2 * Math.PI * RADIUS
    expect(rolled).toBeGreaterThanOrEqual(pose.x)
    expect(rolled - pose.x).toBeLessThan(0.05)
  })

  it('왼쪽 옆 이동과 회전(IMU 요·요 속도, 반시계 +)', () => {
    const spec = mecanumSpec()
    const left = run(spec, 0.5, () => driveOutputs(spec, mecanum(0, -0.5, 0)))
    expect(left.world.pose().y).toBeGreaterThan(0.1)
    expect(Math.abs(left.world.pose().x)).toBeLessThan(1e-9)
    const state = latest(left.inputs)
    // 왼쪽 옆: FL−, FR+, BL+, BR−(팀 코드 기준). 허브 부호로는 왼쪽 모터(REVERSE)가 같은 부호, 오른쪽이 반대
    expect(Math.sign(num(state.fl.position))).toBe(-1)
    expect(Math.sign(num(state.bl.position))).toBe(1)
    expect(Math.sign(num(state.fr.position))).toBe(-1)
    expect(Math.sign(num(state.br.position))).toBe(1)

    const turn = run(spec, 0.5, () => driveOutputs(spec, mecanum(0, 0, -0.4)))
    const yaw = turn.world.pose().yaw
    expect(yaw).toBeGreaterThan(0.3)
    const imu = latest(turn.inputs).imu
    expect(imu.yaw).toBeCloseTo(yaw, 12)
    expect(num(imu.yawRate)).toBeGreaterThan(0)
    expect(Math.abs(turn.world.pose().x)).toBeLessThan(1e-9)
  })

  it('goBILDA 5203 312 RPM 정상 속도 = 모터 식(데이터시트 무부하에서 굴림 저항만큼 뺌, 0.5 %), 바퀴 한 바퀴 = 537.6 틱', () => {
    // 1.7 m/s 가까이 내므로 뒤쪽 벽 가까이에서 출발한다
    const spec = mecanumSpec({
      batteryVoltage: 12.5,
      robot: { ...mecanumSpec().robot, start: { x: -1.5, y: 0, yaw: 0 } }
    })
    const r = run(spec, 1.4, () => driveOutputs(spec, mecanum(1, 0, 0)))
    const omega = steadyRate(1, 12.5)
    // 굴림 저항 몫: 바퀴당 c_rr·N·r ≈ 0.12 N·m가 정지 토크 2.38 N·m의 약 5 %라 무부하보다 그만큼 느리다
    const free = testMotorParams(GOBILDA, GEARBOX).freeSpeed * (12.5 / 12)
    expect(omega / free).toBeGreaterThan(0.93)
    expect(omega / free).toBeLessThan(0.97)
    const state = latest(r.inputs)
    const perRad = ticksPerOutputRev(motorType(GOBILDA), GEARBOX) / (2 * Math.PI)
    // 허브 속도는 50 ms 창의 틱 수 × 20이라 정상 상태에서 진짜 속도와 한 단계(20 틱/s) 안이다
    expect(Math.abs(Math.abs(num(state.fr.velocity)) - omega * perRad)).toBeLessThan(20)
    const x0 = r.world.pose().x
    const more = run(spec, 0.1, () => driveOutputs(spec, mecanum(1, 0, 0)), r)
    const speed = (more.world.pose().x - x0) / 0.1
    expect(Math.abs(speed / (omega * RADIUS) - 1)).toBeLessThan(0.005)
    // 한 바퀴 굴리기: 위치 차 537.6틱 ↔ 이동 2πr(정상 상태 미끄럼 0, 정수 틱 반올림 안)
    const before = num(state.fr.position)
    const after = num(latest(more.inputs).fr.position)
    const travelled = more.world.pose().x - x0
    expect((Math.abs(after - before) / travelled) * 2 * Math.PI * RADIUS).toBeCloseTo(537.6, -1)
  })

  it('전압·듀티: 정상 속도가 모터 식과 같다(13 V·10 V, power 0.3, 허브 속도 한 단계 안)', () => {
    const perRad = ticksPerOutputRev(motorType(GOBILDA), GEARBOX) / (2 * Math.PI)
    for (const volts of [13, 10]) {
      const spec = mecanumSpec({ batteryVoltage: volts })
      const r = run(spec, 2, () => driveOutputs(spec, mecanum(0.3, 0, 0)))
      const v = Math.abs(num(latest(r.inputs).fr.velocity))
      expect(Math.abs(v - steadyRate(0.3, volts) * perRad)).toBeLessThan(20)
      expect(latest(r.inputs)['Control Hub'].voltage).toBe(volts)
    }
    // 듀티가 작으면 일정한 손실(쿨롱·굴림 저항)의 몫이 커서 전압에 정확히 비례하지는 않는다
    expect(steadyRate(0.3, 13) / steadyRate(0.3, 10)).toBeGreaterThan(1.3)
  })

  it('실행 중 setDirection을 반대로 하면 뒤로 가고 엔코더는 허브 부호대로 센다', () => {
    const spec = mecanumSpec()
    // 팀 코드가 인스펙터와 반대 방향을 쓴다: 허브 power의 부호가 바뀐다
    const reversed = (): Record<string, DeviceValues> => {
      const out: Record<string, DeviceValues> = {}
      for (const m of spec.motors) out[m.device] = motorOut(0.5, -m.directionSign)
      return out
    }
    const r = run(spec, 0.5, reversed)
    expect(r.world.pose().x).toBeLessThan(-0.1)
    const state = latest(r.inputs)
    // 허브 power가 +인 오른쪽 모터는 허브 엔코더도 +
    expect(num(reversed().fr.power)).toBeGreaterThan(0)
    expect(num(state.fr.position)).toBeGreaterThan(0)
    expect(num(state.fl.position)).toBeLessThan(0)
  })

  it('RUN_TO_POSITION(허브 위치 P·속도 PIDF): 리셋 오프셋 기준 1000틱에 ±10틱 안으로 서고 유계, 몸체 이동은 엔코더 거리 ± 1 cm(T11)', () => {
    const spec = mecanumSpec()
    // 먼저 조금 달린 뒤 멈춰 서고(원시 틱이 0이 아님) 그 자리에서 리셋했다고 보고 1000틱 앞으로
    const warm = run(spec, 1, (k) => driveOutputs(spec, k < 60 ? mecanum(0.4, 0, 0) : {}))
    const offsets = latest(warm.inputs)
    const x0 = warm.world.pose().x
    const target = 1000
    const rtp = (): Record<string, DeviceValues> => {
      const out: Record<string, DeviceValues> = {}
      for (const m of spec.motors) {
        const hubSign = rotationSign(motorType(GOBILDA)) * m.directionSign
        out[m.device] = motorOut(0.5, m.directionSign, {
          mode: 'RUN_TO_POSITION',
          power: 0.5,
          velocity: 1184,
          targetPosition: target * hubSign,
          encoderOffset: num(offsets[m.device].position)
        })
      }
      return out
    }
    const begin = warm.inputs.length
    const r = run(spec, 4, rtp, warm)
    const seen: number[] = []
    let settledAt = -1
    r.inputs.slice(begin).forEach((step, i) => {
      if (step.fr?.position === undefined) return
      const counted = -(num(step.fr.position) - num(offsets.fr.position))
      seen.push(counted)
      if (settledAt < 0 && Math.abs(counted - target) <= 10) settledAt = i
    })
    // 허브 기본 PIDF는 이 로봇(13.6 kg, 19.2:1)에서 조금 넘칠 수 있다(실제 펌웨어도 같음, 3b 리프트 시험과 같은 기준)
    expect(Math.max(...seen)).toBeLessThan(target + 60)
    expect(settledAt).toBeGreaterThan(0)
    expect(settledAt * 5).toBeLessThan(4000)
    expect(Math.abs(seen[seen.length - 1] - target)).toBeLessThanOrEqual(10)
    const encoderTravel =
      (target / ticksPerOutputRev(motorType(GOBILDA), GEARBOX)) * 2 * Math.PI * RADIUS
    expect(Math.abs(r.world.pose().x - x0 - encoderTravel)).toBeLessThan(0.01)
  })
})

describe('PhysicsWorld 오도메트리', () => {
  const PINPOINT_TICKS_PER_MM = 19.89436789

  function pinpointSpec(): WorldSpec {
    return mecanumSpec({
      pinpoints: [
        {
          device: 'pinpoint',
          xPod: { x: 0.02, y: 0.1 },
          yPod: { x: -0.08, y: -0.03 },
          podTicksPerMm: PINPOINT_TICKS_PER_MM,
          xReversed: false,
          yReversed: false
        }
      ]
    })
  }

  // 팀이 쓴 Pinpoint 설정(오프셋: X 포드 옆 위치 왼쪽 +, Y 포드 앞 위치, mm)
  function pinpointOut(xOffsetMm: number, yOffsetMm: number): DeviceValues {
    return {
      xOffsetMm,
      yOffsetMm,
      ticksPerMm: PINPOINT_TICKS_PER_MM,
      xDirection: 'FORWARD',
      yDirection: 'FORWARD',
      yawScalar: 1
    }
  }

  it('Pinpoint: +x 앞·+y 왼쪽, 원시 포드 틱, 속도는 원시 틀', () => {
    const spec = pinpointSpec()
    const extra = { pinpoint: pinpointOut(100, -80) }
    const fwd = run(spec, 0.6, () => driveOutputs(spec, mecanum(0.5, 0, 0), extra))
    const a = latest(fwd.inputs).pinpoint
    expect(num(a.x)).toBeCloseTo(fwd.world.pose().x * 1000, 0)
    expect(Math.abs(num(a.y))).toBeLessThan(0.5)
    expect(num(a.encoderX)).toBe(Math.floor(fwd.world.pose().x * 1000 * PINPOINT_TICKS_PER_MM))
    expect(num(a.vx)).toBeGreaterThan(500)
    const left = run(spec, 0.6, () => driveOutputs(spec, mecanum(0, -0.5, 0), extra))
    const b = latest(left.inputs).pinpoint
    expect(num(b.y)).toBeCloseTo(left.world.pose().y * 1000, 0)
    expect(num(b.y)).toBeGreaterThan(100)
    expect(num(b.encoderY)).toBeGreaterThan(0)
  })

  it('Pinpoint: 두 바퀴 넘게 돌아도 heading은 감지 않고, 팀 오프셋이 맞으면 제자리, 틀리면 틀어진다', () => {
    const spec = pinpointSpec()
    const spin = (xOff: number, yOff: number): { maxDrift: number; heading: number } => {
      const extra = { pinpoint: pinpointOut(xOff, yOff) }
      // 제자리 회전은 롤러가 √2·a·ω로 미끄러져 롤러 저항을 받는다(동역학): 두 바퀴 넘게 돌도록 power 0.7
      const r = run(spec, 6, () => driveOutputs(spec, mecanum(0, 0, -0.7), extra))
      let maxDrift = 0
      let state: Record<string, DeviceValues> = {}
      for (const step of r.inputs) {
        state = { ...state, ...step, pinpoint: { ...state.pinpoint, ...step.pinpoint } }
        maxDrift = Math.max(maxDrift, Math.hypot(num(state.pinpoint.x), num(state.pinpoint.y)))
      }
      expect(r.world.pose().yaw).toBeGreaterThan(4 * Math.PI)
      expect(num(state.pinpoint.heading)).toBeCloseTo(r.world.pose().yaw, 12)
      return { maxDrift, heading: num(state.pinpoint.heading) }
    }
    const right = spin(100, -80)
    expect(right.heading).toBeGreaterThan(4 * Math.PI)
    expect(right.maxDrift).toBeLessThan(1)
    const wrong = spin(0, 0)
    expect(wrong.maxDrift).toBeGreaterThan(100)
  })

  it('Pinpoint: 해상도를 정하지 않았으면 자세 0(포드 틱은 센다)', () => {
    const spec = pinpointSpec()
    const extra = { pinpoint: { ...pinpointOut(100, -80), ticksPerMm: null } }
    const r = run(spec, 0.5, () => driveOutputs(spec, mecanum(0.5, 0, 0), extra))
    const p = latest(r.inputs).pinpoint
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
    expect(num(p.encoderX)).toBeGreaterThan(1000)
  })

  it('OTOS: SDK 샘플 오프셋(X 오른쪽·Y 앞)과 Road Runner식(h = −90°) 모두 로봇 중심 자세', () => {
    // 센서는 앞 10 cm, 왼쪽 5 cm, 장착 각 0
    const spec = mecanumSpec({
      otos: [{ device: 'otos', position: { x: 0.1, y: 0.05 }, mountingAngle: 0 }]
    })
    const sdk = { otos: { offsetX: -0.05, offsetY: 0.1, offsetH: 0 } }
    const rr = { otos: { offsetX: 0.1, offsetY: 0.05, offsetH: -Math.PI / 2 } }
    for (const [offset, forwardKey, sideKey] of [
      [sdk, 'y', 'x'],
      [rr, 'x', 'y']
    ] as const) {
      const fwd = run(spec, 0.5, () => driveOutputs(spec, mecanum(0.5, 0, 0), offset))
      const o = latest(fwd.inputs).otos
      expect(num(o[forwardKey])).toBeCloseTo(fwd.world.pose().x, 9)
      expect(num(o[sideKey])).toBeCloseTo(0, 9)
      expect(num(o['v' + forwardKey])).toBeGreaterThan(0.3)
      // 제자리 회전: 로봇 중심은 그대로, h는 요
      const spin = run(spec, 1, () => driveOutputs(spec, mecanum(0, 0, -0.4), offset))
      const s = latest(spin.inputs).otos
      expect(num(s.x)).toBeCloseTo(0, 9)
      expect(num(s.y)).toBeCloseTo(0, 9)
      expect(num(s.h)).toBeCloseTo(spin.world.pose().yaw, 9)
      expect(num(s.vh)).toBeGreaterThan(0)
    }
    // 90° 돌려 단 센서에 SDK 오프셋 h = 90°
    const turned = mecanumSpec({
      otos: [{ device: 'otos', position: { x: 0.1, y: 0.05 }, mountingAngle: Math.PI / 2 }]
    })
    const offset = { otos: { offsetX: -0.05, offsetY: 0.1, offsetH: Math.PI / 2 } }
    const fwd = run(turned, 0.5, () => driveOutputs(turned, mecanum(0.5, 0, 0), offset))
    const o = latest(fwd.inputs).otos
    expect(num(o.y)).toBeCloseTo(fwd.world.pose().x, 9)
    expect(num(o.x)).toBeCloseTo(0, 9)
  })

  it('IMU 요는 (−π, π]로 감는다', () => {
    const spec = mecanumSpec({ robot: { ...mecanumSpec().robot, start: { x: 0, y: 0, yaw: 1 } } })
    const r = run(spec, 3, () => driveOutputs(spec, mecanum(0, 0, -0.5)))
    const yaw = r.world.pose().yaw - 1
    expect(yaw).toBeGreaterThan(Math.PI)
    const imu = latest(r.inputs).imu
    expect(num(imu.yaw)).toBeCloseTo(yaw - 2 * Math.PI, 9)
    for (const step of r.inputs)
      if (step.imu?.yaw !== undefined) {
        expect(num(step.imu.yaw)).toBeLessThanOrEqual(Math.PI)
        expect(num(step.imu.yaw)).toBeGreaterThan(-Math.PI)
      }
  })

  it('데드휠: 접점의 이동 × 틱/m, reversed면 반대, strafe는 왼쪽 +, 같은 이름 모터의 엔코더는 포드 값', () => {
    const spec = mecanumSpec({
      deadWheels: [
        {
          device: 'par',
          position: { x: 0, y: 0.12 },
          measures: 'forward',
          reversed: false,
          ticksPerMeter: 2000
        },
        {
          device: 'parR',
          position: { x: 0, y: -0.12 },
          measures: 'forward',
          reversed: true,
          ticksPerMeter: 2000
        },
        {
          device: 'fr',
          position: { x: -0.1, y: 0 },
          measures: 'strafe',
          reversed: false,
          ticksPerMeter: 2000
        }
      ]
    })
    const fwd = run(spec, 0.5, () => driveOutputs(spec, mecanum(0.5, 0, 0)))
    const a = latest(fwd.inputs)
    const x = fwd.world.pose().x
    expect(a.par.position).toBe(Math.floor(x * 2000))
    expect(a.parR.position).toBe(Math.floor(-x * 2000))
    // fr 포트에는 strafe 포드가 꽂혀 있다: 앞으로 가면 0(모터 축 엔코더가 아니다)
    expect(a.fr.position).toBe(0)
    const left = run(spec, 0.5, () => driveOutputs(spec, mecanum(0, -0.5, 0)))
    const b = latest(left.inputs)
    expect(b.fr.position).toBe(Math.floor(left.world.pose().y * 2000))
    expect(num(b.fr.position)).toBeGreaterThan(100)
    // 제자리 회전: 왼쪽 포드는 뒤로, 뒤 strafe 포드는 오른쪽으로(−)
    const turn = run(spec, 0.3, () => driveOutputs(spec, mecanum(0, 0, -0.4)))
    const c = latest(turn.inputs)
    expect(num(c.par.position)).toBeLessThan(0)
    expect(num(c.fr.position)).toBeLessThan(0)
  })

  it('데드휠과 포트를 함께 쓰는 모터를 엔코더 모드로 돌리면 sharedEncoderMode를 한 번 알린다', () => {
    const spec = mecanumSpec({
      deadWheels: [
        {
          device: 'fr',
          position: { x: 0, y: 0 },
          measures: 'strafe',
          reversed: false,
          ticksPerMeter: 2000
        }
      ]
    })
    const world = new PhysicsWorld(spec)
    const out = (): Record<string, DeviceValues> =>
      driveOutputs(spec, {}, { fr: motorOut(0, 1, { mode: 'RUN_USING_ENCODER', velocity: 0 }) })
    world.step(0, driveOutputs(spec, {}))
    expect(world.drainNotices()).toEqual([])
    world.step(TICK, out())
    world.step(2 * TICK, out())
    expect(world.drainNotices()).toEqual([{ code: 'sharedEncoderMode', params: { device: 'fr' } }])
    world.step(3 * TICK, out())
    expect(world.drainNotices()).toEqual([])
  })

  it('데드휠과 포트를 함께 쓰는 모터: 포드가 멈춰 있어도 리셋 횟수가 바뀌면 그때의 축 틱을 RUN_TO_POSITION 기준으로', () => {
    // fr 포트에는 가운데 strafe 포드: 앞으로만 가면 포드(사이드카의 encoderOffset)는 늘 0이다
    const spec = mecanumSpec({
      deadWheels: [
        {
          device: 'fr',
          position: { x: 0, y: 0 },
          measures: 'strafe',
          reversed: false,
          ticksPerMeter: 2000
        }
      ]
    })
    // 0.2초 앞으로 간 뒤 멈춰 선다(축은 ±수백 틱, 리셋 때 바퀴는 서 있다)
    const warm = run(spec, 1, (k) => driveOutputs(spec, k < 40 ? mecanum(0.5, 0, 0) : {}))
    const target = 500
    const travel = (target / ticksPerOutputRev(motorType(GOBILDA), GEARBOX)) * 2 * Math.PI * RADIUS
    // 팀 코드가 한 루프에서 리셋 → 목표 → RUN_TO_POSITION을 해서 틱 경계가 STOP_AND_RESET_ENCODER를 보지 못했다.
    // 축 엔코더 모터는 사이드카의 encoderOffset(리셋 때 position)이, 포드 포트는 리셋 횟수(encoderResets)만 바뀐다.
    const rtp = (resets: number, from: Run): ((k: number) => Record<string, DeviceValues>) => {
      const state = latest(from.inputs)
      const out: Record<string, DeviceValues> = {}
      for (const m of spec.motors) {
        const hubSign = rotationSign(motorType(GOBILDA)) * m.directionSign
        out[m.device] = motorOut(0.5, m.directionSign, {
          mode: 'RUN_TO_POSITION',
          power: 0.5,
          velocity: 1184,
          targetPosition: target * hubSign,
          encoderOffset: num(state[m.device].position),
          encoderResets: resets
        })
      }
      return () => out
    }
    let r = warm
    let x = warm.world.pose().x
    expect(x).toBeGreaterThan(0.1)
    expect(latest(warm.inputs).fr.position).toBe(0)
    // 두 번 리셋한다(두 번째도 포드는 그대로라 encoderOffset이 같다)
    // 왼쪽·오른쪽 축 틱의 소수부를 정수 오프셋이 다르게 잘라(1323.35 → 1323, −1323.35 → −1324) 양쪽 굴림이 1틱까지
    // 다를 수 있다(요 ~1e-3). 기준을 놓치면 fr이 수백 틱 거꾸로 돌아 수 cm 옆으로 밀리고 크게 돈다.
    for (const resets of [1, 2]) {
      r = run(spec, 3, rtp(resets, r), r)
      expect(Math.abs(num(latest(r.inputs).fr.position))).toBeLessThanOrEqual(1)
      const pose = r.world.pose()
      // 바퀴가 목표에 먼저 서고 몸체가 조금 더 미끄러진다(정확한 쿨롱 마찰, 감속이 견인 한계를 넘음): 엔코더 거리 ± 2 cm
      expect(Math.abs(pose.x - x - travel)).toBeLessThan(0.02)
      expect(Math.abs(pose.y)).toBeLessThan(1e-3)
      expect(Math.abs(pose.yaw)).toBeLessThan(5e-3)
      x = pose.x
    }
  })
})

describe('PhysicsWorld 허브 엔코더 속도', () => {
  // 50 ms 창 = 5 ms 틱 10개
  const WINDOW_TICKS = 10

  // 틱마다 장치의 누적 입력(사이드카가 그 틱부터 보는 값)
  function perTick(r: Run, device: string): { position: number; velocity: number }[] {
    const out: { position: number; velocity: number }[] = []
    let state: DeviceValues = {}
    for (const step of r.inputs) {
      state = { ...state, ...step[device] }
      out.push({ position: num(state.position), velocity: num(state.velocity) })
    }
    return out
  }

  // 사이드카가 받은 속도가 허브 규칙(지난 50 ms의 원시 틱 변화 × 20, 시작 전은 멈춰 있었으므로 처음 50 ms는 시작 position
  // 기준)과 같다
  function expectHubRule(ticks: { position: number; velocity: number }[]): void {
    ticks.forEach((tick, k) => {
      const before = k >= WINDOW_TICKS ? ticks[k - WINDOW_TICKS].position : ticks[0].position
      expect(tick.velocity, `tick ${k}`).toBe((tick.position - before) * 20)
      expect(Math.abs(tick.velocity % 20), `tick ${k}`).toBe(0)
    })
  }

  it('모터: 지난 50 ms 원시 틱 변화 × 20이라 늘 20의 배수이고, 정상 상태에서 진짜 속도와 한 단계 안이다', () => {
    const spec = mecanumSpec()
    const r = run(spec, 1.5, () => driveOutputs(spec, mecanum(0.6, 0, 0)))
    const fl = perTick(r, 'fl')
    expectHubRule(fl)
    for (const device of ['fr', 'bl', 'br']) expectHubRule(perTick(r, device))
    // 처음 50 ms: 시작 전에는 멈춰 있었으므로 시작 position부터 센다
    expect(fl[5].velocity).toBe(fl[5].position * 20)
    // 가속하는 동안 창 값은 늘고, 정상 상태는 모터 식의 속도(정수가 아니다)와 한 단계(20 틱/s) 안이다
    expect(fl[20].velocity).toBeGreaterThan(fl[10].velocity)
    const perRad = ticksPerOutputRev(motorType(GOBILDA), GEARBOX) / (2 * Math.PI)
    expect(Math.abs(fl[fl.length - 1].velocity - steadyRate(0.6, VOLTS) * perRad)).toBeLessThan(20)
  })

  it('데드휠(따로 꽂은 것·모터 포트를 함께 쓰는 것): 같은 규칙, int16을 넘어도 감지 않는다(감기는 가짜 SDK의 short)', () => {
    // REV Through Bore 8192 CPR, 35 mm 바퀴: 1 m/s에 약 74,500 틱/s
    const ticksPerMeter = 8192 / (Math.PI * 0.035)
    const spec = mecanumSpec({
      deadWheels: [
        {
          device: 'par',
          position: { x: 0, y: 0.1 },
          measures: 'forward',
          reversed: false,
          ticksPerMeter
        },
        {
          device: 'fr',
          position: { x: -0.1, y: 0 },
          measures: 'strafe',
          reversed: true,
          ticksPerMeter
        }
      ]
    })
    // 앞으로 1초, 그다음 왼쪽으로 1초(회전 없음: 포드 이동 = 로봇 이동)
    const world = new PhysicsWorld(spec)
    const inputs: Record<string, DeviceValues>[] = []
    const poses: { x: number; y: number; yaw: number }[] = []
    for (let k = 0; k < 400; k++) {
      inputs.push(
        world.step(k * TICK, driveOutputs(spec, k < 200 ? mecanum(0.6, 0, 0) : mecanum(0, -0.6, 0)))
      )
      poses.push(world.pose())
    }
    const r: Run = { world, inputs, t: 399 * TICK }
    const par = perTick(r, 'par')
    const fr = perTick(r, 'fr')
    expectHubRule(par)
    expectHubRule(fr)
    // 값은 그 창(지난 50 ms)의 포드 접점 평균 속도와 한 단계(20 틱/s) 안이다. 동역학이라 앞에서 옆으로 바꿀 때 하중이 앞으로
    // 쏠린 동안 조금 돈다(앞뒤 바퀴의 견인·롤러 감쇠가 달라서): 포드 이동은 로봇 좌표 변위(회전 포함)로 센다
    const mean = (
      k: number,
      pod: { x: number; y: number },
      measures: 'forward' | 'strafe',
      sign: number
    ): number => {
      const t = twistBetween(poses[k - WINDOW_TICKS], poses[k])
      const travel = measures === 'forward' ? t.dx - t.dTheta * pod.y : t.dy + t.dTheta * pod.x
      return (sign * travel * ticksPerMeter) / 0.05
    }
    const parPod = { x: 0, y: 0.1 }
    const frPod = { x: -0.1, y: 0 }
    for (const k of [20, 100, 199]) {
      expect(Math.abs(par[k].velocity - mean(k, parPod, 'forward', 1)), `par ${k}`).toBeLessThan(20)
      expect(fr[k].velocity).toBe(0)
    }
    for (const k of [220, 300, 399])
      expect(Math.abs(fr[k].velocity - mean(k, frPod, 'strafe', -1)), `fr ${k}`).toBeLessThan(20)
    // 앞으로 갈 때 par는 int16(32767)을 훨씬 넘고, 옆으로 갈 때 fr 포트의 strafe 포드(reversed)가 −로 넘는다
    expect(par[199].velocity).toBeGreaterThan(60_000)
    expect(fr[399].velocity).toBeLessThan(-40_000)
  })

  it('막힌 동안 데드휠 속도는 0이고, 전출력이면 바퀴가 헛돌아 모터 엔코더 속도가 돈다', () => {
    const start = { x: WALL_INNER_HALF - HALF, y: 0, yaw: 0 }
    const spec = mecanumSpec({
      robot: { ...mecanumSpec().robot, start },
      deadWheels: [
        {
          device: 'par',
          position: { x: 0, y: 0.1 },
          measures: 'forward',
          reversed: false,
          ticksPerMeter: 2000
        }
      ]
    })
    // power 1: 바퀴 힘(≈ τ_s/r = 46 N)이 견인 한계 μ·N(= 20 N)보다 커서 헛돈다(power 0.5면 모터가 막힌다: T6b·T17)
    const r = run(spec, 1, () => driveOutputs(spec, mecanum(1, 0, 0)))
    const state = latest(r.inputs)
    expect(state.par.velocity).toBe(0)
    expect(Math.abs(num(state.fr.velocity))).toBeGreaterThan(1000)
    expect(Math.abs(num(state.fr.velocity) % 20)).toBe(0)
  })

  it('결정적: 틱 간격이 달라도 같은 시각의 속도는 같고, 같은 출력열이면 같은 값', () => {
    const spec = mecanumSpec()
    const a = new PhysicsWorld(spec)
    const b = new PhysicsWorld(spec)
    const drive = (k: number): Record<string, DeviceValues> =>
      driveOutputs(spec, mecanum(Math.sin(k / 30), 0.3 * Math.cos(k / 50), 0.2))
    const velocityA: number[] = []
    const velocityB: number[] = []
    let stateA: DeviceValues = {}
    let stateB: DeviceValues = {}
    // b의 틱은 a의 두 틱마다이고, a의 홀수 틱 출력은 앞 짝수 틱의 것이다(두 세계가 같은 명령·1 ms 하위 단계로 적분한다)
    for (let k = 0; k <= 400; k++) {
      stateA = { ...stateA, ...a.step(k * TICK, drive(k & ~1))['bl'] }
      if (k % 2 === 0) {
        stateB = { ...stateB, ...b.step(k * TICK, drive(k))['bl'] }
        velocityA.push(num(stateA.velocity))
        velocityB.push(num(stateB.velocity))
      }
    }
    expect(velocityB).toEqual(velocityA)
    expect(new Set(velocityA).size).toBeGreaterThan(50)
  })
})

describe('PhysicsWorld 벽', () => {
  const LIMIT = WALL_INNER_HALF

  it('시작부터 벽에 걸쳐 있어도 튀지 않고, 더 들어가는 이동만 막는다', () => {
    const start = { x: LIMIT - HALF + 0.05, y: 0, yaw: 0 }
    const spec = mecanumSpec({ robot: { ...mecanumSpec().robot, start } })
    const r = run(spec, 0.5, () => driveOutputs(spec, mecanum(0.5, 0, 0)))
    // 벽에 닿은 채 시작했다: 밀어내지도 더 들어가지도 않는다(정칙화 잔차만, spec-3c §1.5 침투 상한 1e-6 m)
    expect(Math.abs(r.world.pose().x - start.x)).toBeLessThan(1e-9)
    expect(r.world.pose().blocked).toBe(true)
    // 뒤로는 자유롭다
    const back = run(spec, 0.5, () => driveOutputs(spec, mecanum(-0.5, 0, 0)), r)
    expect(back.world.pose().x).toBeLessThan(start.x - 0.1)
    expect(back.world.pose().blocked).toBe(false)
  })

  it('벽을 따라 미끄러진다(벽에 수직인 성분만 막힘)', () => {
    const start = { x: LIMIT - HALF - 0.01, y: 0, yaw: 0 }
    const spec = mecanumSpec({ robot: { ...mecanumSpec().robot, start } })
    // 앞(+x, 벽)과 왼쪽(+y)으로 함께
    // 옆/앞 힘 비 1.5가 벽 마찰 μ_w = 0.4보다 크므로 미끄러진다(벽 마찰·롤러 저항만큼 느리다, 경계는 worldDrive.test.ts T6)
    const r = run(spec, 0.8, () => driveOutputs(spec, mecanum(0.4, -0.6, 0)))
    const pose = r.world.pose()
    expect(pose.x + HALF).toBeCloseTo(LIMIT, 9)
    expect(pose.y).toBeGreaterThan(0.05)
    expect(pose.blocked).toBe(true)
    // 반대 벽(−y)도
    const startY = { x: 0, y: -(LIMIT - HALF), yaw: 0 }
    const specY = mecanumSpec({ robot: { ...mecanumSpec().robot, start: startY } })
    // 앞 0.5·오른쪽 0.3: 옆으로 미는 바퀴 둘은 앞으로 구르며 굴림 저항·역기전력으로 버티므로 앞 성분이 커야 미끄러진다
    const s = run(specY, 0.5, () => driveOutputs(specY, mecanum(0.7, 0.25, 0)))
    expect(s.world.pose().y - HALF).toBeCloseTo(-LIMIT, 9)
    expect(s.world.pose().x).toBeGreaterThan(0.1)
  })

  it('막힌 동안 데드휠은 멈추고, 바퀴가 헛돌면(전출력) 모터 엔코더는 계속 돈다', () => {
    const start = { x: LIMIT - HALF, y: 0, yaw: 0 }
    const spec = mecanumSpec({
      robot: { ...mecanumSpec().robot, start },
      deadWheels: [
        {
          device: 'par',
          position: { x: 0, y: 0.1 },
          measures: 'forward',
          reversed: false,
          ticksPerMeter: 2000
        }
      ]
    })
    const r = run(spec, 1, () => driveOutputs(spec, mecanum(1, 0, 0)))
    const state = latest(r.inputs)
    expect(state.par.position).toBe(0)
    expect(Math.abs(num(state.fr.position))).toBeGreaterThan(500)
    // 벽에 닿은 채 시작했다: 밀어내지도 더 들어가지도 않는다(정칙화 잔차만, spec-3c §1.5 침투 상한 1e-6 m)
    expect(Math.abs(r.world.pose().x - start.x)).toBeLessThan(1e-9)
    expect(r.world.pose().blocked).toBe(true)
  })
})

describe('PhysicsWorld 결정성', () => {
  it('dt는 틱 시각 차이: 틱 간격이 달라도 같은 1 ms 하위 단계면 같은 자세', () => {
    const spec = mecanumSpec()
    const a = new PhysicsWorld(spec)
    const b = new PhysicsWorld(spec)
    const out = driveOutputs(spec, mecanum(0.5, 0.2, 0.1))
    a.step(0, out)
    b.step(0, out)
    for (let k = 1; k <= 200; k++) a.step(k * TICK, out)
    for (let k = 1; k <= 100; k++) b.step(k * 2 * TICK, out)
    expect(b.pose()).toEqual(a.pose())
    // 틱이 늦게 와도(긴 구간) 그 시간만큼 적분한다
    const c = new PhysicsWorld(spec)
    c.step(0, out)
    c.step(1000 * 1_000_000, out)
    expect(c.pose().x).toBeCloseTo(a.pose().x, 9)
  })

  it('같은 출력열이면 입력열이 바이트까지 같고 NaN·Infinity가 없다', () => {
    const spec = mecanumSpec({
      pinpoints: [
        {
          device: 'pinpoint',
          xPod: { x: 0, y: 0.1 },
          yPod: null,
          podTicksPerMm: 13.26291192,
          xReversed: true,
          yReversed: false
        }
      ],
      otos: [{ device: 'otos', position: { x: 0.1, y: 0 }, mountingAngle: 0.3 }]
    })
    const outputs = (k: number): Record<string, DeviceValues> =>
      driveOutputs(
        spec,
        mecanum(Math.sin(k / 40), Math.cos(k / 70) * 0.5, Math.sin(k / 25) * 0.3),
        {
          pinpoint: {
            ticksPerMm: 13.26291192,
            xOffsetMm: 100,
            yOffsetMm: 0,
            xDirection: 'REVERSED',
            yDirection: 'FORWARD'
          },
          otos: { offsetX: 0, offsetY: 0.1, offsetH: 0.3 }
        }
      )
    const one = run(spec, 3, outputs)
    const two = run(spec, 3, outputs)
    const text = JSON.stringify(one.inputs)
    expect(JSON.stringify(two.inputs)).toBe(text)
    expect(text).not.toContain('null')
    for (const step of one.inputs)
      for (const values of Object.values(step))
        for (const value of Object.values(values)) expect(Number.isFinite(value)).toBe(true)
    for (const key of ['position', 'velocity'])
      for (const step of one.inputs)
        if (step.fl?.[key] !== undefined) expect(Number.isInteger(step.fl[key])).toBe(true)
  })

  it('장치 이름이 __proto__여도 프로토타입을 건드리지 않는다', () => {
    const spec = mecanumSpec({ imus: [{ device: '__proto__' }] })
    const world = new PhysicsWorld(spec)
    const inputs = world.step(0, driveOutputs(spec, {}))
    expect(Object.prototype.hasOwnProperty.call(inputs, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(inputs)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).yaw).toBeUndefined()
  })
})
