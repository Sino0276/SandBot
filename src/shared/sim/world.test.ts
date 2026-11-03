import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { WALL_INNER_HALF } from './field'
import { TAU_DRIVE } from './motorModel'
import { motorType, noLoadOutputRadPerSec, rotationSign, ticksPerOutputRev } from './motorTypes'
import { testChassis, testMotorParams, testWheelPhysics } from './testkit'
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

describe('PhysicsWorld 메카넘', () => {
  it('첫 호출은 적분하지 않고 모든 입력, 그 뒤는 바뀐 키만', () => {
    const spec = mecanumSpec()
    const world = new PhysicsWorld(spec)
    const first = world.step(0, driveOutputs(spec, mecanum(1, 0, 0)))
    expect(Object.keys(first)).toEqual(['Control Hub', 'fl', 'fr', 'bl', 'br', 'imu'])
    expect(first['Control Hub']).toEqual({ voltage: VOLTS })
    expect(first.fl).toEqual({ position: 0, velocity: 0 })
    expect(first.imu).toEqual({ yaw: 0, pitch: 0, roll: 0, yawRate: 0, pitchRate: 0, rollRate: 0 })
    expect(world.pose()).toEqual({ x: 0, y: 0, yaw: 0, blocked: false })
    // 출력이 바뀌지 않고 아무것도 움직이지 않으면 보낼 것이 없다
    const still = new PhysicsWorld(spec)
    still.step(0, driveOutputs(spec, {}))
    expect(still.step(TICK, driveOutputs(spec, {}))).toEqual({})
    // 앞 틱의 출력(앞으로)으로 적분했으므로 엔코더·속도만 바뀐다(허브·IMU 값은 그대로). 첫 5 ms는 0.3틱쯤이라 정수
    // 엔코더가 아직 그대로인 모터가 있으므로 한 틱 더 간다.
    world.step(TICK, driveOutputs(spec, mecanum(1, 0, 0)))
    const next = world.step(2 * TICK, driveOutputs(spec, {}))
    expect(Object.keys(next)).toEqual(['fl', 'fr', 'bl', 'br'])
    for (const values of Object.values(next))
      for (const value of Object.values(values)) expect(Number.isInteger(value)).toBe(true)
  })

  it('앞으로: 표준 메카넘 순방향, 엔코더는 허브 부호(팀 코드에서 앞으로 갈 때 는다)', () => {
    const spec = mecanumSpec()
    const r = run(spec, 1, () => driveOutputs(spec, mecanum(0.6, 0, 0)))
    const pose = r.world.pose()
    expect(pose.x).toBeGreaterThan(0.5)
    expect(Math.abs(pose.y)).toBeLessThan(1e-9)
    expect(Math.abs(pose.yaw)).toBeLessThan(1e-9)
    const state = latest(r.inputs)
    // goBILDA(CCW) FORWARD(오른쪽): 허브 −, REVERSE(왼쪽): 허브 + → 팀 코드는 둘 다 +
    expect(num(state.fr.position)).toBeLessThan(0)
    expect(num(state.br.position)).toBeLessThan(0)
    expect(num(state.fl.position)).toBeGreaterThan(0)
    expect(num(state.bl.position)).toBeGreaterThan(0)
    // 바퀴 굴림 = 로봇 이동(미끄럼 없음): 틱 = 이동 ÷ 둘레 × 출력축 1회전 틱
    const perRev = ticksPerOutputRev(motorType(GOBILDA), GEARBOX)
    expect(Math.abs(num(state.fr.position))).toBeCloseTo(
      (pose.x / (2 * Math.PI * RADIUS)) * perRev,
      -1
    )
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

  it('goBILDA 5203 312 RPM: 최고 속도 = 무부하 × 전압/12 × 반지름, 바퀴 한 바퀴 = 537.6 틱', () => {
    // 1.8 m/s 가까이 내므로 뒤쪽 벽 가까이에서 출발한다
    const spec = mecanumSpec({
      batteryVoltage: 12.5,
      robot: { ...mecanumSpec().robot, start: { x: -1.5, y: 0, yaw: 0 } }
    })
    const r = run(spec, 0.9, () => driveOutputs(spec, mecanum(1, 0, 0)))
    const state = latest(r.inputs)
    const type = motorType(GOBILDA)
    const omega = noLoadOutputRadPerSec(type, GEARBOX) * (12.5 / 12)
    const perRad = ticksPerOutputRev(type, GEARBOX) / (2 * Math.PI)
    // 허브 속도는 50 ms 창의 틱 수 × 20이라 정상 상태에서 진짜 속도와 한 단계(20 틱/s) 안이다
    expect(Math.abs(Math.abs(num(state.fr.velocity)) - omega * perRad)).toBeLessThan(20)
    const x0 = r.world.pose().x
    const stateAtX0 = latest(r.inputs)
    const more = run(spec, 0.1, () => driveOutputs(spec, mecanum(1, 0, 0)), r)
    expect((more.world.pose().x - x0) / 0.1).toBeCloseTo(omega * RADIUS, 3)
    // 한 바퀴 굴리기: 위치 차 537.6틱 ↔ 이동 2πr
    const before = num(stateAtX0.fr.position)
    const after = num(latest(more.inputs).fr.position)
    const travelled = more.world.pose().x - x0
    expect((Math.abs(after - before) / travelled) * 2 * Math.PI * RADIUS).toBeCloseTo(537.6, -1)
  })

  it('전압에 비례한다', () => {
    const fast = mecanumSpec({ batteryVoltage: 13 })
    const slow = mecanumSpec({ batteryVoltage: 10 })
    const a = run(fast, 2, () => driveOutputs(fast, mecanum(0.3, 0, 0)))
    const b = run(slow, 2, () => driveOutputs(slow, mecanum(0.3, 0, 0)))
    // 허브 속도는 20 틱/s 단위라 각각 정상 상태 속도와 한 단계 안이다
    const type = motorType(GOBILDA)
    const perRad = ticksPerOutputRev(type, GEARBOX) / (2 * Math.PI)
    const full = noLoadOutputRadPerSec(type, GEARBOX) * perRad * 0.3
    const va = Math.abs(num(latest(a.inputs).fr.velocity))
    const vb = Math.abs(num(latest(b.inputs).fr.velocity))
    expect(Math.abs(va - (full * 13) / 12)).toBeLessThan(20)
    expect(Math.abs(vb - (full * 10) / 12)).toBeLessThan(20)
    expect(latest(a.inputs)['Control Hub'].voltage).toBe(13)
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

  it('RUN_TO_POSITION: 리셋 오프셋 기준 목표까지 넘침 없이 서고 사이드카 허용 오차 안에 든다', () => {
    const spec = mecanumSpec()
    // 먼저 조금 달린 뒤(원시 틱이 0이 아님) 그 자리에서 리셋했다고 보고 1000틱 앞으로
    const warm = run(spec, 0.3, () => driveOutputs(spec, mecanum(0.4, 0, 0)))
    const offsets = latest(warm.inputs)
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
      if (settledAt < 0 && Math.abs(counted - target) <= 5) settledAt = i
    })
    expect(Math.max(...seen)).toBeLessThanOrEqual(target)
    expect(settledAt).toBeGreaterThan(0)
    // 5 ms 틱이므로 4초 안
    expect(settledAt * 5).toBeLessThan(4000)
    expect(Math.abs(seen[seen.length - 1] - target)).toBeLessThanOrEqual(1)
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
      const r = run(spec, 6, () => driveOutputs(spec, mecanum(0, 0, -0.5), extra))
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
      expect(pose.x - x).toBeCloseTo(travel, 3)
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

  it('모터: 지난 50 ms 원시 틱 변화 × 20이라 늘 20의 배수이고, 창 가운데(약 25 ms 전)의 속도다', () => {
    const spec = mecanumSpec()
    const r = run(spec, 1, () => driveOutputs(spec, mecanum(0.6, 0, 0)))
    const fl = perTick(r, 'fl')
    expectHubRule(fl)
    for (const device of ['fr', 'bl', 'br']) expectHubRule(perTick(r, device))
    // 정지에서 출발한 1차 응답(power는 t = 0부터): 원시 틱 = r∞·(t − τ(1 − e^(−t/τ))), 속도 = r∞·(1 − e^(−t/τ))
    const type = motorType(GOBILDA)
    const rInf =
      (0.6 * noLoadOutputRadPerSec(type, GEARBOX) * ticksPerOutputRev(type, GEARBOX)) /
      (2 * Math.PI)
    const raw = (t: number): number => rInf * (t - TAU_DRIVE * -Math.expm1(-t / TAU_DRIVE))
    const rate = (t: number): number => rInf * -Math.expm1(-t / TAU_DRIVE)
    // 틱 k(시각 5k ms)의 값은 그 창의 평균 속도와 20 틱/s 안에서 같고, 가속하는 동안은 25 ms 전의 속도에 가깝다
    for (const k of [10, 20, 40]) {
      const t = k * 0.005
      const mean = (raw(t) - raw(t - 0.05)) / 0.05
      expect(Math.abs(fl[k].velocity - mean), `tick ${k}`).toBeLessThan(20)
      expect(Math.abs(fl[k].velocity - rate(t - 0.025))).toBeLessThan(
        Math.abs(fl[k].velocity - rate(t))
      )
    }
    // 처음 50 ms: 시작 전에는 멈춰 있었으므로 시작 position부터 센다(아직 작은 값)
    expect(fl[5].velocity).toBe(fl[5].position * 20)
    expect(fl[5].velocity).toBeLessThan(rate(0.025))
    // 정상 상태: 진짜 속도(정수가 아니다)와 한 단계(20 틱/s) 안
    expect(Math.abs(fl[fl.length - 1].velocity - rInf)).toBeLessThan(20)
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
    const poses: { x: number; y: number }[] = []
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
    // 값은 그 창(지난 50 ms)의 평균 속도와 한 단계(20 틱/s) 안이다
    const mean = (k: number, axis: 'x' | 'y', sign: number): number =>
      (sign * (poses[k][axis] - poses[k - WINDOW_TICKS][axis]) * ticksPerMeter) / 0.05
    for (const k of [20, 100, 199]) {
      expect(Math.abs(par[k].velocity - mean(k, 'x', 1)), `par ${k}`).toBeLessThan(20)
      expect(fr[k].velocity).toBe(0)
    }
    for (const k of [220, 300, 399])
      expect(Math.abs(fr[k].velocity - mean(k, 'y', -1)), `fr ${k}`).toBeLessThan(20)
    // 앞으로 갈 때 par는 int16(32767)을 훨씬 넘고, 옆으로 갈 때 fr 포트의 strafe 포드(reversed)가 −로 넘는다
    expect(par[199].velocity).toBeGreaterThan(60_000)
    expect(fr[399].velocity).toBeLessThan(-40_000)
  })

  it('막힌 동안 데드휠 속도는 0이고 모터 엔코더 속도는 돈다', () => {
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
    const r = run(spec, 1, () => driveOutputs(spec, mecanum(0.5, 0, 0)))
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
    expect(r.world.pose().x).toBeCloseTo(start.x, 12)
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
    const r = run(spec, 0.8, () => driveOutputs(spec, mecanum(0.4, -0.4, 0)))
    const pose = r.world.pose()
    expect(pose.x + HALF).toBeCloseTo(LIMIT, 9)
    expect(pose.y).toBeGreaterThan(0.2)
    expect(pose.blocked).toBe(true)
    // 반대 벽(−y)도
    const startY = { x: 0, y: -(LIMIT - HALF), yaw: 0 }
    const specY = mecanumSpec({ robot: { ...mecanumSpec().robot, start: startY } })
    const s = run(specY, 0.5, () => driveOutputs(specY, mecanum(0.3, 0.4, 0)))
    expect(s.world.pose().y - HALF).toBeCloseTo(-LIMIT, 9)
    expect(s.world.pose().x).toBeGreaterThan(0.1)
  })

  it('막힌 동안 데드휠은 멈추고 모터 엔코더는 계속 돈다', () => {
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
    const r = run(spec, 1, () => driveOutputs(spec, mecanum(0.5, 0, 0)))
    const state = latest(r.inputs)
    expect(state.par.position).toBe(0)
    expect(Math.abs(num(state.fr.position))).toBeGreaterThan(500)
    expect(r.world.pose().x).toBeCloseTo(start.x, 12)
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
