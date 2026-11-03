import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { BODY_DIODE_DROP, DcGearMotor } from './actuators'
import { resolveMotorParams, resolveServoParams } from './actuatorData'
import { Articulation, MIN_COORDINATE_INERTIA, type DriveForces } from './articulation'
import { motorType, rotationSign } from './motorTypes'
import { GRAVITY } from './physics'
import { testChassis, testMotorParams } from './testkit'
import { PhysicsWorld } from './world'
import {
  WORLD_SPEC_VERSION,
  type SimJointSpec,
  type SimMotorParams,
  type SimServoParams,
  type WorldSpec
} from './worldSpec'

// 시험 값의 출처(scratchpad p10mass/research/actuators.md = [ACT], p11joint/research/data.md):
//   goBILDA 5203 19.2:1(312 RPM): 정지 24.3 kg·cm = 2.383 N·m, 9.2 A, 무부하 0.25 A, 정확한 비 19.2032([ACT] §2.1)
//   효율: 유성 2단 0.95² = 0.9025(spec-3b §1.2), 회전자 관성 3.0e-6 kg·m²(data §1.3), 역구동 2.3 mN·m(data §3.2)
//   스풀: goBILDA Viper 키트 둘레 112 mm(data §5.1), 리프트 1.5 kg(3b method T3)
const TAG = 'goBILDA5202SeriesMotor'
const SPOOL = 0.112 / (2 * Math.PI)
const LOAD = 1.5
const VOLTS = 12
const PARAMS: SimMotorParams = {
  stallTorque: 2.383,
  freeSpeed: (312 * 2 * Math.PI) / 60,
  stallCurrent: 9.2,
  freeCurrent: 0.25,
  gearbox: 19.2032,
  efficiency: 0.9025,
  rotorInertia: 3e-6,
  backdriveFriction: 2.3e-3
}
// 마찰 없는 모터(해석해 대조용: 무부하 전류 0이면 점성 0, 역구동 0)
const FRICTIONLESS: SimMotorParams = { ...PARAMS, freeCurrent: 0, backdriveFriction: 0 }
// 허브 각 → "앞"(위): goBILDA는 CCW 형식(−1), 인스펙터 방향 forward(+1)
const FORWARD = rotationSign(motorType(TAG))
const ZERO = { x: 0, y: 0, z: 0 }

function lift(change: Partial<SimJointSpec> = {}, params = PARAMS): SimJointSpec {
  return {
    parent: -1,
    type: 'prismatic',
    origin: { position: ZERO, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: { lower: -0.5, upper: 0.5 },
    body: { mass: LOAD, centerOfMass: ZERO, inertia: [0, 0, 0, 0, 0, 0] },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'motor', devices: ['lift'], ratio: SPOOL, params, rigging: { kind: 'direct' } },
    switches: [],
    ...change
  }
}

function world(joints: SimJointSpec[], change: Partial<WorldSpec> = {}): WorldSpec {
  return {
    version: WORLD_SPEC_VERSION,
    robot: {
      start: { x: 0, y: 0, yaw: 0 },
      footprint: [
        { x: 0.2, y: 0.2 },
        { x: -0.2, y: 0.2 },
        { x: -0.2, y: -0.2 },
        { x: 0.2, y: -0.2 }
      ],
      body: testChassis()
    },
    batteryVoltage: VOLTS,
    hubs: ['Control Hub'],
    motors: [
      {
        device: 'lift',
        modelTag: TAG,
        gearbox: 19.2,
        directionSign: 1,
        params: testMotorParams(TAG, 19.2)
      }
    ],
    wheels: [],
    deadWheels: [],
    pinpoints: [],
    otos: [],
    imus: [],
    joints,
    ...change
  }
}

// 리프트 모터 출력. up: 팀 코드 기준 power(+면 위), 허브 power는 형식 방향을 적용한 값
function motorOut(up: number, change: DeviceValues = {}): Record<string, DeviceValues> {
  return {
    lift: {
      mode: 'RUN_WITHOUT_ENCODER',
      power: up * FORWARD,
      velocity: null,
      enabled: true,
      zeroPower: 'BRAKE',
      targetPosition: null,
      targetTolerance: 5,
      encoderOffset: 0,
      encoderResets: 0,
      ...change
    }
  }
}

type Run = {
  world: PhysicsWorld
  inputs: Record<string, DeviceValues>[]
  q: number[][]
  tick: number
}

function run(
  spec: WorldSpec,
  seconds: number,
  outputs: (k: number) => Record<string, DeviceValues>,
  tick = 5_000_000
): Run {
  const w = new PhysicsWorld(spec)
  const inputs: Record<string, DeviceValues>[] = []
  const q: number[][] = []
  for (let k = 0; k <= Math.round((seconds * 1e9) / tick); k++) {
    inputs.push(w.step(k * tick, outputs(k)))
    q.push(w.pose().joints ?? [])
  }
  return { world: w, inputs, q, tick }
}

// 입력열을 장치·키마다 그 틱까지의 마지막 값으로
function latestAt(inputs: Record<string, DeviceValues>[], k: number): Record<string, DeviceValues> {
  const state: Record<string, DeviceValues> = {}
  for (const step of inputs.slice(0, k + 1))
    for (const [device, values] of Object.entries(step))
      state[device] = { ...state[device], ...values }
  return state
}

const dc = new DcGearMotor(PARAMS)
const dcFree = new DcGearMotor(FRICTIONLESS)
// 모터 좌표(출력축)의 관성: 짐 m·r² + 회전자 J·G² + 바닥
const coordinateInertia = (p: SimMotorParams): number =>
  LOAD * SPOOL * SPOOL + p.rotorInertia * p.gearbox * p.gearbox + MIN_COORDINATE_INERTIA

describe('관절 리프트(모터 구동 직선 관절)', () => {
  it('FLOAT(꺼짐)로 떨어지는 가속은 m·g/(m + J·G²/r²)이다(±1 %)', () => {
    const r = run(
      world([lift({}, FRICTIONLESS)]),
      0.1,
      () => motorOut(0, { enabled: false }),
      1_000_000
    )
    const t = 0.1
    // 반암시 오일러: q_k = a·h²·k(k + 1)/2
    const measured = (2 * r.q[r.q.length - 1][0]) / (t * (t + 0.001))
    const expected = (-LOAD * GRAVITY * SPOOL * SPOOL) / coordinateInertia(FRICTIONLESS)
    expect(Math.abs(measured / expected - 1)).toBeLessThan(0.01)
  })

  it('BRAKE(power 0)는 일정한 속도로 처지고(±1 %), 정지 마찰이 무게보다 크면 정확히 멈춘다', () => {
    const r = run(world([lift({}, FRICTIONLESS)]), 1, () => motorOut(0))
    const n = r.q.length - 1
    const speed = (r.q[n][0] - r.q[n - 20][0]) / 0.1
    const g = dcFree.gearbox
    const damping = (g * g * dcFree.torqueConstant * dcFree.backEmfConstant) / dcFree.resistance
    const expected = (-LOAD * GRAVITY * SPOOL * SPOOL) / damping
    expect(Math.abs(speed / expected - 1)).toBeLessThan(0.01)

    const held = run(world([lift({ friction: { coulomb: 20, viscous: 0 } })]), 0.5, () =>
      motorOut(0)
    )
    for (const q of held.q) expect(q[0]).toBe(0)
    expect(latestAt(held.inputs, held.inputs.length - 1).lift.position).toBe(0)
  })

  it('정전력(power 1) 리프트의 정상 속도(±0.5 %)와 63 % 시간(±5 %)이 모터 식과 같다', () => {
    const r = run(world([lift()]), 0.6, () => motorOut(1), 1_000_000)
    const g = dc.gearbox
    const eta = dc.efficiency
    const k = (dc.torqueConstant * dc.backEmfConstant) / dc.resistance
    // η·G·Kt(V − Ke·G·ω)/R − G·τc − G²·b·ω = m·g·r
    const drive = (eta * g * dc.torqueConstant * VOLTS) / dc.resistance
    const damping = eta * g * g * k + g * g * dc.viscous
    const omega = (drive - g * dc.coulomb - LOAD * GRAVITY * SPOOL) / damping
    const n = r.q.length - 1
    const speed = (r.q[n][0] - r.q[n - 10][0]) / 0.01
    expect(Math.abs(speed / (omega * SPOOL) - 1)).toBeLessThan(0.005)
    // 1 ms 틱의 평균 속도가 63 %를 지나는 시각(틱 가운데로 보간)
    const tau = coordinateInertia(PARAMS) / damping
    const target = 0.632 * omega * SPOOL
    let crossing = NaN
    for (let i = 1; i <= n; i++) {
      const v = (r.q[i][0] - r.q[i - 1][0]) / 0.001
      if (v >= target) {
        const before = i > 1 ? (r.q[i - 1][0] - r.q[i - 2][0]) / 0.001 : 0
        crossing = (i - 1.5 + (target - before) / (v - before)) * 0.001
        break
      }
    }
    expect(Math.abs(crossing / tau - 1)).toBeLessThan(0.05)
  })

  it('위 한계에서 power 1을 유지하면 침투 없이 멈추고 엔코더가 그대로이며 정지 전류를 낸다', () => {
    const r = run(world([lift({ limits: { lower: 0, upper: 0.3 } })]), 2, () => motorOut(1))
    let reached = -1
    r.q.forEach((q, k) => {
      expect(q[0]).toBeLessThanOrEqual(0.3 + 1e-15)
      if (reached < 0 && q[0] >= 0.3 - 1e-12) reached = k
    })
    expect(reached).toBeGreaterThan(0)
    const atLimit = latestAt(r.inputs, reached).lift.position
    // 50 ms 창이 지난 뒤로는 위치·속도 입력이 바뀌지 않는다
    for (let k = reached + 1; k < r.inputs.length; k++)
      expect(r.inputs[k].lift?.position).toBeUndefined()
    const last = latestAt(r.inputs, r.inputs.length - 1).lift
    expect(last.position).toBe(atLimit)
    expect(last.velocity).toBe(0)
    // 멈춘 모터: I = V/R(정지 전류)
    expect(last.current as number).toBeCloseTo(VOLTS / dc.resistance, 9)
  })

  it('FLOAT로 아래 한계에 빠르게 닿아도 반발하지 않는다', () => {
    const r = run(world([lift({ limits: { lower: -0.2, upper: 0.5 } }, FRICTIONLESS)]), 1.5, () =>
      motorOut(0, { enabled: false })
    )
    let reached = -1
    r.q.forEach((q, k) => {
      expect(q[0]).toBeGreaterThanOrEqual(-0.2 - 1e-15)
      if (reached < 0 && q[0] <= -0.2 + 1e-12) reached = k
      if (reached >= 0) expect(q[0]).toBe(r.q[reached][0])
    })
    expect(reached).toBeGreaterThan(0)
  })

  it('RUN_TO_POSITION으로 목표 틱에 닿고 중력에 버틴다(허용 오차 5틱 안)', () => {
    // 팀 목표 +1000틱(위) = 허브 −1000틱, setPower(1)의 목표 속도 = 형식 최대 2368틱/s(SDK 반올림)
    const target = 1000 * FORWARD
    const r = run(world([lift()]), 4, () =>
      motorOut(0, {
        mode: 'RUN_TO_POSITION',
        power: 1,
        velocity: 2368,
        targetPosition: target
      })
    )
    for (let k = r.inputs.length - 200; k < r.inputs.length; k++) {
      const position = latestAt(r.inputs, k).lift.position as number
      expect(Math.abs(position - target)).toBeLessThanOrEqual(5)
    }
    // 위로 갔다(관절 q > 0): 1000틱 = 1000/(537.6/2π)·r m
    expect(r.q[r.q.length - 1][0]).toBeCloseTo(
      (((1000 / 537.6) * 2 * Math.PI * 19.2) / 19.2) * SPOOL,
      2
    )
  })

  it('RUN_USING_ENCODER는 목표 속도 근처에서 유계로 돈다(기본 PIDF), 계수 0이면 듀티 0', () => {
    const target = 1000 * FORWARD
    const out = (pidf: number[] | undefined) => () =>
      motorOut(0, {
        mode: 'RUN_USING_ENCODER',
        power: 1000 / 2368,
        velocity: target,
        ...(pidf ? { velocityPidf: pidf as unknown as number } : {})
      })
    const r = run(world([lift({ limits: { lower: -0.5, upper: 2 } })]), 1.5, out(undefined))
    const tail: number[] = []
    for (let k = r.inputs.length - 100; k < r.inputs.length; k++)
      tail.push(latestAt(r.inputs, k).lift.velocity as number)
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length
    expect(Math.abs(mean / target - 1)).toBeLessThan(0.05)
    for (const v of tail) expect(Math.abs(v)).toBeLessThan(2 * Math.abs(target))
    // 팀이 쓴 계수(모두 0)를 따른다: 듀티 0(코스트)이라 들지 못하고 내려간다
    const zero = run(world([lift({ limits: { lower: -0.5, upper: 2 } })]), 0.5, out([0, 0, 0, 0]))
    expect(zero.q[zero.q.length - 1][0]).toBeLessThan(0)
  })

  it('틱 간격(5 ms·7 ms)이 달라도 같은 하위 단계 격자라 자세가 거의 같다(±0.5 %)', () => {
    const a = run(world([lift()]), 0.35, () => motorOut(1), 5_000_000)
    const b = run(world([lift()]), 0.35, () => motorOut(1), 7_000_000)
    const qa = a.q[a.q.length - 1][0]
    const qb = b.q[b.q.length - 1][0]
    expect(Math.abs(qa / qb - 1)).toBeLessThan(0.005)
  })

  it('같은 출력열이면 같은 프로세스에서 입력열·자세가 바이트까지 같다', () => {
    const scenario = (): string => {
      const r = run(
        world([
          lift({
            limits: { lower: 0, upper: 0.3 },
            switches: [{ device: 'bottom', kind: 'touch', at: 'lower', within: 0.002 }]
          })
        ]),
        2,
        (k) =>
          k < 100
            ? motorOut(0, {
                mode: 'RUN_TO_POSITION',
                power: 1,
                velocity: 2368,
                targetPosition: -800
              })
            : motorOut(k < 250 ? -0.6 : 0, { zeroPower: k < 300 ? 'BRAKE' : 'FLOAT' })
      )
      return JSON.stringify([r.inputs, r.q])
    }
    const text = scenario()
    expect(text).toBe(scenario())
    expect(text).not.toContain('null')
  })

  it('리밋 스위치: touch는 끝 근처에서 pressed, digital은 state false(풀업 LOW)', () => {
    const r = run(
      world([
        lift({
          limits: { lower: 0, upper: 0.1 },
          switches: [
            { device: 'bottom', kind: 'touch', at: 'lower', within: 0.002 },
            { device: 'top', kind: 'digital', at: 'upper', within: 0.002 }
          ]
        })
      ]),
      1,
      () => motorOut(1)
    )
    expect(r.inputs[0].bottom).toEqual({ pressed: true })
    expect(r.inputs[0].top).toEqual({ state: true })
    const last = latestAt(r.inputs, r.inputs.length - 1)
    expect(last.bottom.pressed).toBe(false)
    expect(last.top.state).toBe(false)
  })

  it('관절이 없는 세계의 자세에는 joints 키가 없다', () => {
    const w = new PhysicsWorld(world([], { motors: [] }))
    w.step(0, {})
    expect(Object.keys(w.pose())).toEqual(['x', 'y', 'yaw', 'blocked'])
  })
})

describe('continuous 리깅 리프트', () => {
  const stage = (parent: number, change: Partial<SimJointSpec>): SimJointSpec =>
    lift({
      parent,
      limits: { lower: 0, upper: 0.244 },
      body: { mass: 0.3, centerOfMass: ZERO, inertia: [0, 0, 0, 0, 0, 0] },
      ...change
    })

  it('두 단이 위 한계에 닿은 뒤 power 1을 유지해도 엔코더가 멈춰 있다(떨림 없음)', () => {
    const r = run(
      world([
        stage(-1, {
          drive: {
            kind: 'motor',
            devices: ['lift'],
            ratio: SPOOL,
            params: {
              ...PARAMS,
              gearbox: 13.7336,
              stallTorque: 1.834,
              freeSpeed: (435 * 2 * Math.PI) / 60
            },
            rigging: { kind: 'continuous', stages: [1] }
          }
        }),
        stage(0, { drive: { kind: 'stage' } })
      ]),
      2,
      () => motorOut(1)
    )
    const [q1, q2] = r.q[r.q.length - 1]
    expect(q1).toBeCloseTo(0.244, 6)
    expect(q2).toBeCloseTo(0.244, 6)
    for (let k = r.inputs.length - 100; k < r.inputs.length; k++) {
      expect(r.inputs[k].lift?.position).toBeUndefined()
      const last = latestAt(r.inputs, k).lift
      expect(last.velocity).toBe(0)
    }
  })

  for (const zeroPower of ['BRAKE', 'FLOAT'] as const)
    it(`단 마찰(쿨롱 1 N·점성 0.5)이 있어도 위 한계에 닿은 뒤 ${zeroPower}로 바꿔도 한계를 넘지 않고 수치 오류가 없다`, () => {
      // 쿨롱 마찰 행이 같은 단의 한계 행과 평행해 구속 행렬이 특이하다(예전에는 LCP가 순환해 맨 위 단이 µm 넘었다).
      // 단 마찰 값은 spec-3b 기본값, 그 밖은 위 시험과 같다.
      const friction = { coulomb: 1, viscous: 0.5 }
      const spec = world([
        stage(-1, {
          friction,
          drive: {
            kind: 'motor',
            devices: ['lift'],
            ratio: SPOOL,
            params: {
              ...PARAMS,
              gearbox: 13.7336,
              stallTorque: 1.834,
              freeSpeed: (435 * 2 * Math.PI) / 60
            },
            rigging: { kind: 'continuous', stages: [1] }
          }
        }),
        stage(0, { friction, drive: { kind: 'stage' } })
      ])
      const r = run(spec, 4, (k) => (k * 0.005 < 2 ? motorOut(1) : motorOut(0, { zeroPower })))
      expect(r.world.drainNotices()).toEqual([])
      for (const q of r.q)
        for (const x of q) {
          expect(x).toBeLessThanOrEqual(0.244 + 1e-9)
          expect(x).toBeGreaterThanOrEqual(-1e-9)
        }
      // 2 s 뒤 두 단 모두 위 한계, 끝에는 BRAKE는 위 근처에서 천천히 처지고 FLOAT는 아래 한계까지 떨어진다
      expect(r.q[400][0] + r.q[400][1]).toBeCloseTo(0.488, 6)
      const [q1, q2] = r.q[r.q.length - 1]
      if (zeroPower === 'BRAKE') expect(q1 + q2).toBeGreaterThan(0.4)
      else expect(q1 + q2).toBeLessThan(1e-6)
    })
})

describe('전력단 발전 제동(본체 다이오드)', () => {
  // goBILDA 5203 19.2:1, 스풀 Ø38.2 mm(goBILDA 3407 계열), 1.5 kg 짐, 단 마찰 spec-3b 기본값(1 N·0.5 N·s/m), 0.8 m 행정.
  // 2 s 동안 power 1로 올린 뒤 내린다. 중력이 돕는 하강은 역기전력이 단자를 묶는 전압을 넘으면 회생 전류가 흐르므로 무부하
  // 속도 근처에서 묶인다. 묶는 전압은 power −1이 레일 V(FET), 부분 듀티가 V + (1 − |d|)·Vf(꺼짐 구간은 다이오드 하나),
  // FLOAT·꺼짐·듀티 0이 V + 2·Vf(다이오드 둘)라, 그만큼 빨리 내린다(속도 차 ≤ ΔV/(Ke·G)·반지름).
  const radius = 0.0382 / 2
  const free = PARAMS.freeSpeed * radius
  const motor = new DcGearMotor(PARAMS)
  const shift = (volts: number): number =>
    (volts / (motor.backEmfConstant * PARAMS.gearbox)) * radius
  const spec = world([
    lift({
      limits: { lower: 0, upper: 0.8 },
      friction: { coulomb: 1, viscous: 0.5 },
      drive: {
        kind: 'motor',
        devices: ['lift'],
        ratio: radius,
        params: PARAMS,
        rigging: { kind: 'direct' }
      }
    })
  ])
  const lowering = (down: Record<string, DeviceValues>): { peak: number; peakTicks: number } => {
    const r = run(spec, 5, (k) => (k * 0.005 < 2 ? motorOut(1) : down))
    expect(r.q[400][0]).toBeCloseTo(0.8, 6)
    let peak = 0
    let peakTicks = 0
    for (let i = 401; i < r.q.length; i++) {
      peak = Math.max(peak, (r.q[i - 1][0] - r.q[i][0]) / 0.005)
      const v = r.inputs[i].lift?.velocity
      if (typeof v === 'number') peakTicks = Math.max(peakTicks, Math.abs(v))
    }
    return { peak, peakTicks }
  }
  const full = lowering(motorOut(-1))
  const vf = BODY_DIODE_DROP
  const cases: [string, Record<string, DeviceValues>, number][] = [
    ['FLOAT', motorOut(0, { zeroPower: 'FLOAT' }), 2 * vf],
    ['꺼짐', motorOut(0, { enabled: false }), 2 * vf],
    ['power −0.05', motorOut(-0.05), 0.95 * vf],
    ['power −0.3', motorOut(-0.3), 0.7 * vf],
    ['power −0.99', motorOut(-0.99), 0.01 * vf]
  ]

  it('power −1은 무부하 속도 근처에서 묶인다', () => {
    expect(full.peak).toBeGreaterThan(free)
    expect(full.peak).toBeLessThan(1.2 * free)
  })

  for (const [label, down, drop] of cases)
    it(`${label}로 내리면 무부하 속도 근처에서 묶이고 power −1보다 다이오드 강하만큼만 빠르다`, () => {
      const { peak, peakTicks } = lowering(down)
      expect(peak).toBeLessThanOrEqual(full.peak + shift(drop) * (1 + 1e-3))
      if (drop > 0.1) expect(peak).toBeGreaterThan(full.peak + 0.5 * shift(drop))
      expect(peak).toBeLessThan(1.35 * free)
      // 허브 엔코더 속도도 무부하(28 틱 × 6000 rpm ÷ 60 = 2800 틱/s)의 1.35배 안
      expect(peakTicks).toBeLessThan(1.35 * 2800)
    })

  it('FLOAT는 다이오드 강하(2·Vf ≈ 무부하 역기전력의 12 %)만큼 power −1보다 빨리 내린다', () => {
    expect(shift(2 * vf) / free).toBeGreaterThan(0.11)
    expect(shift(2 * vf) / free).toBeLessThan(0.13)
  })

  it('듀티 0.99와 1.0은 거의 같다(연속)', () => {
    const near = lowering(motorOut(-0.99))
    expect(Math.abs(near.peak / full.peak - 1)).toBeLessThan(0.02)
  })
})

describe('관절 모터 엔코더 해상도', () => {
  // 가벼운 수평 팔(중력 토크 없음)을 power 1로 돌리고, 출력축 1회전에 센 원시 틱을 제조사 출력축 카운트와 맞춘다
  for (const [tag, perRev] of [
    ['RevRoboticsUltraplanetaryHDHexMotor', 28 * (76 / 21) * (68 / 13)],
    ['NeveRest20Gearmotor', 537.6],
    ['RevRoboticsCoreHexMotor', 288]
  ] as const)
    it(`${tag}(모델 기본 감속비): 출력축 1회전 = ${perRev.toFixed(1)}틱`, () => {
      const params = resolveMotorParams(tag, 'default')
      const arm: SimJointSpec = {
        ...lift({}, params),
        type: 'revolute',
        axis: { x: 0, y: 0, z: 1 },
        limits: null,
        body: { mass: 0.1, centerOfMass: ZERO, inertia: [1e-4, 1e-4, 1e-4, 0, 0, 0] },
        drive: { kind: 'motor', devices: ['lift'], ratio: 1, params, rigging: { kind: 'direct' } }
      }
      const spec = world([arm], {
        motors: [
          {
            device: 'lift',
            modelTag: tag,
            gearbox: motorType(tag).gearing,
            directionSign: 1,
            params: testMotorParams(tag, 'default')
          }
        ]
      })
      const r = run(spec, 1, () => ({
        lift: {
          mode: 'RUN_WITHOUT_ENCODER',
          power: 1,
          velocity: null,
          enabled: true,
          zeroPower: 'BRAKE',
          targetPosition: null,
          targetTolerance: 5,
          encoderOffset: 0,
          encoderResets: 0
        }
      }))
      const turns = Math.abs(r.q[r.q.length - 1][0]) / (2 * Math.PI)
      const ticks = Math.abs(latestAt(r.inputs, r.inputs.length - 1).lift.position as number)
      expect(turns).toBeGreaterThan(1)
      expect(Math.abs(ticks - perRev * turns)).toBeLessThanOrEqual(1)
    })
})

describe('강성·유계', () => {
  it('회전자 관성 0, 99.5:1, 작은 부하의 BRAKE 감속은 발산하지 않고 단조롭게 준다(암시 감쇠)', () => {
    // goBILDA 5203 99.5:1(60 RPM, 133.2 kg·cm = 13.06 N·m, [ACT] §2.1), 손목 4.5e-5 kg·m²(50 g·3 cm, 3b method §4 가정)
    const params: SimMotorParams = {
      ...PARAMS,
      stallTorque: 13.062,
      freeSpeed: (60 * 2 * Math.PI) / 60,
      gearbox: 99.5075,
      efficiency: 0.95 ** 3,
      rotorInertia: 0
    }
    const wrist: SimJointSpec = {
      ...lift({}, params),
      type: 'revolute',
      axis: { x: 0, y: 0, z: 1 },
      limits: null,
      body: { mass: 0.05, centerOfMass: { x: 0.03, y: 0, z: 0 }, inertia: [0, 0, 0, 0, 0, 0] },
      drive: { kind: 'motor', devices: ['lift'], ratio: 1, params, rigging: { kind: 'direct' } }
    }
    const art = new Articulation([wrist])
    art.v[0] = 5
    const motor = new DcGearMotor(params)
    const brake = (): DriveForces => {
      const terms = motor.terms({ kind: 'brake' }, 12, 0)
      return {
        force: [0],
        damping: [terms.damping + params.gearbox ** 2 * motor.viscous],
        stiffness: [0],
        boxLo: [0],
        boxHi: [0],
        regions: terms.region
      }
    }
    let previous = art.v[0]
    for (let k = 0; k < 50; k++) {
      art.step(1e-3, brake)
      expect(Number.isFinite(art.v[0])).toBe(true)
      expect(art.v[0]).toBeGreaterThanOrEqual(0)
      expect(art.v[0]).toBeLessThanOrEqual(previous)
      previous = art.v[0]
    }
    expect(previous).toBeLessThan(1e-3)
  })

  it('큰 관성 팔의 RUN_USING_ENCODER(기본 PIDF, 19.2:1)는 유계다', () => {
    // 수평으로 도는 팔(중력 토크 없음) 0.1 kg·m²(3b 비평 §2.3의 가장 무거운 부하)
    const arm: SimJointSpec = {
      ...lift(),
      type: 'revolute',
      axis: { x: 0, y: 0, z: 1 },
      limits: null,
      body: { mass: 1, centerOfMass: ZERO, inertia: [0.1, 0.1, 0.1, 0, 0, 0] },
      drive: {
        kind: 'motor',
        devices: ['lift'],
        ratio: 1,
        params: PARAMS,
        rigging: { kind: 'direct' }
      }
    }
    const target = 500 * FORWARD
    const r = run(world([arm]), 3, () =>
      motorOut(0, { mode: 'RUN_USING_ENCODER', power: 500 / 2368, velocity: target })
    )
    for (let k = 0; k < r.inputs.length; k++) {
      const v = latestAt(r.inputs, k).lift.velocity as number
      expect(Math.abs(v)).toBeLessThan(3 * 500)
    }
  })
})

describe('서보 관절', () => {
  // goBILDA 25-2 Torque, 허브 5 V 보간([ACT] §5.2): 1.76 N·m, 4.33 rad/s. 600–2400 µs = 270°([ACT] §5.3), 데드밴드 4 µs.
  // kp = τs/5°([ACT] §5.4), kd·limpFriction은 가정(시험용)
  const SERVO: SimServoParams = {
    stallTorque: 1.76,
    freeSpeed: 4.33,
    rangeAngle: (270 * Math.PI) / 180,
    deadbandUs: 4,
    kp: 1.76 / ((5 * Math.PI) / 180),
    kd: 0.05,
    crFullPower: 1,
    limpFriction: 0.05
  }
  // 수평 팔(0.2 kg, 무게중심 0.15 m): +Y 회전이 중력 방향(아래)이다
  const arm = (
    change: Partial<SimJointSpec> = {},
    kind: 'servo' | 'crServo' = 'servo'
  ): SimJointSpec => ({
    parent: -1,
    type: 'revolute',
    origin: { position: ZERO, rotation: ZERO },
    axis: { x: 0, y: 1, z: 0 },
    limits: null,
    body: {
      mass: 0.2,
      centerOfMass: { x: 0.15, y: 0, z: 0 },
      inertia: [1e-5, 1e-4, 1e-4, 0, 0, 0]
    },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive:
      kind === 'servo'
        ? { kind, device: 'wrist', ratio: 1, params: SERVO, zeroPulseUs: 1500, direction: 1 }
        : {
            kind,
            device: 'wrist',
            ratio: 1,
            params: { ...SERVO, crFullPower: 0.667 },
            direction: 1
          },
    switches: [],
    ...change
  })
  const servoWorld = (joint: SimJointSpec): WorldSpec => world([joint], { motors: [] })
  const servoOut =
    (pulseUs: number | null, pwm = true) =>
    () => ({ wrist: { position: 0.5, pulseUs, pwm } })

  it('부하가 걸리면 kp와 데드밴드만큼 처진다', () => {
    const r = run(servoWorld(arm()), 2, servoOut(1500))
    const q = r.q[r.q.length - 1][0]
    const deadband = 2 * (SERVO.rangeAngle / 1800)
    const load = 0.2 * GRAVITY * 0.15
    // kp·(q − 데드밴드) = m·g·L·cos q
    const expected = deadband + (load * Math.cos(q)) / SERVO.kp
    expect(Math.abs(q / expected - 1)).toBeLessThan(0.02)
  })

  it('큰 계단 명령은 무부하 속도로 묶인다', () => {
    // 수직 축 팔(중력 토크 없음), 2400 µs = +135°
    const r = run(servoWorld(arm({ axis: { x: 0, y: 0, z: 1 } })), 1.5, servoOut(2400), 1_000_000)
    let fastest = 0
    for (let i = 1; i < r.q.length; i++)
      fastest = Math.max(fastest, (r.q[i][0] - r.q[i - 1][0]) / 0.001)
    expect(fastest).toBeLessThanOrEqual(SERVO.freeSpeed * (1 + 1e-9))
    expect(fastest).toBeGreaterThan(0.9 * SERVO.freeSpeed)
    expect(r.q[r.q.length - 1][0]).toBeCloseTo((135 * Math.PI) / 180, 2)
  })

  it('편집 자세의 서보 위치(zeroPulseUs)와 방향: 닫힌 채 모델링한 집게를 setPosition(0.35)로 닫으면 편집 자세에 선다', () => {
    // 수직 축 팔(중력 토크 없음). 편집 자세 = setPosition(0.35) = 600 + 1800 × 0.35 = 1230 µs
    const claw = (direction: 1 | -1): SimJointSpec =>
      arm({
        axis: { x: 0, y: 0, z: 1 },
        drive: {
          kind: 'servo',
          device: 'wrist',
          ratio: 1,
          params: SERVO,
          zeroPulseUs: 1230,
          direction
        }
      })
    const at = (pulseUs: number, direction: 1 | -1): number => {
      const r = run(servoWorld(claw(direction)), 1, servoOut(pulseUs))
      return r.q[r.q.length - 1][0]
    }
    expect(Math.abs(at(1230, 1))).toBeLessThan(1e-9)
    // setPosition(0.5) = 1500 µs는 편집 자세에서 270 µs × 0.15°/µs = +40.5°, 방향 −1이면 −40.5°
    const step = (270 / 1800) * SERVO.rangeAngle
    expect(at(1500, 1)).toBeCloseTo(step, 2)
    expect(at(1500, -1)).toBeCloseTo(-step, 2)
  })

  it('CR 서보 방향 −1은 +펄스가 관절 −축으로 돈다', () => {
    const r = run(
      servoWorld(
        arm(
          {
            axis: { x: 0, y: 0, z: 1 },
            drive: {
              kind: 'crServo',
              device: 'wrist',
              ratio: 1,
              params: { ...SERVO, crFullPower: 0.667 },
              direction: -1
            }
          },
          'crServo'
        )
      ),
      1,
      servoOut(2400),
      1_000_000
    )
    const n = r.q.length - 1
    expect((r.q[n][0] - r.q[n - 100][0]) / 0.1).toBeCloseTo(-SERVO.freeSpeed, 2)
  })

  it('PWM이 꺼지면 힘이 빠져 떨어지고, 기어 마찰이 크면 그대로 있다', () => {
    const limp = run(servoWorld(arm()), 0.3, servoOut(null, false))
    expect(limp.q[limp.q.length - 1][0]).toBeGreaterThan(0.2)
    const held = run(
      servoWorld(
        arm({
          drive: {
            kind: 'servo',
            device: 'wrist',
            ratio: 1,
            params: { ...SERVO, limpFriction: 0.5 },
            zeroPulseUs: 1500,
            direction: 1
          }
        })
      ),
      0.3,
      servoOut(null, false)
    )
    for (const q of held.q) expect(q[0]).toBe(0)
  })

  // 실제 앱 E2E 재현(p11joint e2e): 질량이 없는 몸체(1 g, 관성 바닥 4e-8 = play/worldJoints.ts의 FALLBACK_BODY_MASS·
  // MIN_BODY_INERTIA)의 goBILDA Speed CR 서보 인테이크, 회전 관절 기본 마찰(쿨롱 0.02·점성 0.001). setPower(1) 뒤
  // setPower(−0.5)(1050 µs)로 바꾸면 거꾸로 −0.9 × 무부하 근처로 돈다(예전에는 역구동 포화 구간의 일정 토크가 한 하위
  // 단계에 영을 넘어가 +780 rad/s로 폭주했다).
  for (const inertia of [4e-8, 5e-7, 3e-6, 1e-4])
    it(`CR 서보가 가벼운 몸체(관성 ${inertia})에서 방향을 바꿔도 폭주하지 않는다: power 1 → −0.5는 약 −8.6 rad/s`, () => {
      const params = resolveServoParams('gobildaSpeed', 'crServo')
      const intake: SimJointSpec = {
        parent: -1,
        type: 'revolute',
        origin: { position: ZERO, rotation: ZERO },
        axis: { x: 1, y: 0, z: 0 },
        limits: null,
        body: { mass: 0.001, centerOfMass: ZERO, inertia: [inertia, inertia, inertia, 0, 0, 0] },
        friction: { coulomb: 0.02, viscous: 0.001 },
        spring: null,
        drive: { kind: 'crServo', device: 'intake', ratio: 1, params, direction: 1 },
        switches: []
      }
      const r = run(world([intake], { motors: [] }), 2, (k) => ({
        intake: { position: 0, power: 0, pulseUs: k < 200 ? 2400 : 1050, pwm: true }
      }))
      const rate = (i: number): number => (r.q[i][0] - r.q[i - 1][0]) / 0.005
      for (let i = 1; i < r.q.length; i++)
        expect(Math.abs(rate(i))).toBeLessThanOrEqual(params.freeSpeed * (1 + 1e-9))
      expect(rate(199)).toBeGreaterThan(9)
      const n = r.q.length - 1
      const reversed = (r.q[n][0] - r.q[n - 20][0]) / 0.1
      // 정상: τs·u − (τs/ωf + 점성)·ω − 쿨롱 = 0, u = −450/(900 × crFullPower)
      const u = -450 / (900 * params.crFullPower)
      const slope = params.stallTorque / params.freeSpeed
      const expected = (params.stallTorque * u + 0.02) / (slope + 0.001)
      expect(reversed).toBeCloseTo(expected, 2)
      expect(reversed).toBeGreaterThan(-9)
      expect(reversed).toBeLessThan(-8.3)
    })

  // 정지 토크보다 무거운 팔(흔한 설계 실수): 무게중심 0.25 m, 수평에서 중력 토크 = 과부하 × τs. 서보는 수평(1500 µs =
  // 편집 자세)을 명령한다. 역구동되는 서보는 모터 직선 τ = −τs − (τs/ωf)·ω를 따라 빨리 돌릴수록 더 버티므로(DC 모터를 도는
  // 방향과 반대로 구동, [ACT] §5.4) 정적 평형 acos(1/과부하) 근처에 내려앉고 무부하 속도 남짓보다 빨리 돌지 않는다. 기준은 같은
  // 모델(포화한 모터 직선과 관절 마찰)을 작은 간격 RK4로 푼 진자다. 예전에는 역구동 토크가 속도와 관계없이 ±τs라 감쇠 없는
  // 진자처럼 평형을 0.55 rad 넘어 흔들렸고, 2배 과부하에서는 무부하 속도보다 빨라져 한계에 부딪쳤다. 감쇠 τs/ωf가 팔 관성에
  // 비해 작으면(goBILDA Speed, 2배) 모터 직선 그대로도 덜 감쇠되어 평형을 한 번 넘는다.
  for (const model of ['gobildaTorque', 'gobildaSpeed'] as const)
    for (const overload of [1.3, 2])
      it(`${model} 서보 팔이 정지 토크의 ${overload}배 부하면 정적 평형 근처로 내려앉고 무부하 속도를 넘지 않는다`, () => {
        const params = resolveServoParams(model, 'servo')
        const reach = 0.25
        const mass = (overload * params.stallTorque) / (GRAVITY * reach)
        const coulomb = 0.02
        const viscous = 0.001
        const heavy: SimJointSpec = {
          parent: -1,
          type: 'revolute',
          origin: { position: { x: 0, y: 0, z: 0.3 }, rotation: ZERO },
          axis: { x: 0, y: 1, z: 0 },
          limits: { lower: -1.5, upper: 1.5 },
          body: {
            mass,
            centerOfMass: { x: reach, y: 0, z: 0 },
            inertia: [1e-6, 1e-6, 1e-6, 0, 0, 0]
          },
          friction: { coulomb, viscous },
          spring: null,
          drive: {
            kind: 'servo',
            device: 'arm',
            ratio: 1,
            params,
            zeroPulseUs: 1500,
            direction: 1
          },
          switches: []
        }
        const r = run(world([heavy], { motors: [] }), 3, () => ({
          arm: { position: 0.5, pulseUs: 1500, pwm: true }
        }))
        // 기준 진자(+q가 아래): I·q̈ = m·g·L·cos q + τ_서보 − 점성·q̇ − 쿨롱·sign q̇
        const ts = params.stallTorque
        const slope = ts / params.freeSpeed
        const deadband = (params.deadbandUs / 2) * (params.rangeAngle / 1800)
        const inertia = mass * reach * reach + 1e-6
        const accel = (q: number, w: number): number => {
          const e = -q
          const pd =
            Math.abs(e) <= deadband
              ? -params.kd * w
              : params.kp * (e - Math.sign(e) * deadband) - params.kd * w
          const servo = Math.min(ts - slope * w, Math.max(-ts - slope * w, pd))
          const load = mass * GRAVITY * reach * Math.cos(q) - viscous * w
          const net = load + servo
          const friction =
            w !== 0 ? -Math.sign(w) * coulomb : -Math.sign(net) * Math.min(coulomb, Math.abs(net))
          return (net + friction) / inertia
        }
        let q = 0
        let w = 0
        let referencePeak = 0
        const dt = 1e-5
        for (let k = 0; k < 3 / dt; k++) {
          const k1 = [w, accel(q, w)]
          const k2 = [w + (dt / 2) * k1[1], accel(q + (dt / 2) * k1[0], w + (dt / 2) * k1[1])]
          const k3 = [w + (dt / 2) * k2[1], accel(q + (dt / 2) * k2[0], w + (dt / 2) * k2[1])]
          const k4 = [w + dt * k3[1], accel(q + dt * k3[0], w + dt * k3[1])]
          q += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
          w += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
          referencePeak = Math.max(referencePeak, q)
        }
        const equilibrium = Math.acos(1 / overload)
        let highest = -Infinity
        for (let i = 1; i < r.q.length; i++) {
          const at = r.q[i][0]
          highest = Math.max(highest, at)
          expect(Math.abs(at - r.q[i - 1][0]) / 0.005).toBeLessThanOrEqual(params.freeSpeed * 1.05)
          expect(at).toBeLessThan(1.5)
        }
        expect(Math.abs(highest - referencePeak)).toBeLessThan(0.03)
        // 끝에는 정적 평형 근처에 멈춰 있다(마찰 0.02 N·m만큼 어긋날 수 있다)
        const last = r.q[r.q.length - 1][0]
        expect(Math.abs(last - equilibrium)).toBeLessThan(0.05)
        expect(Math.abs(last - r.q[r.q.length - 41][0])).toBeLessThan(1e-3)
        // goBILDA Torque 1.3배는 과감쇠라 평형을 넘지 않는다
        if (model === 'gobildaTorque' && overload === 1.3)
          expect(highest).toBeLessThan(equilibrium + 0.02)
      })

  it('CR 서보는 펄스에 비례한 속도로 돌고 최고 속도에서 묶인다', () => {
    const r = run(
      servoWorld(arm({ axis: { x: 0, y: 0, z: 1 } }, 'crServo')),
      1,
      servoOut(2400),
      1_000_000
    )
    const n = r.q.length - 1
    const speed = (r.q[n][0] - r.q[n - 100][0]) / 0.1
    expect(speed).toBeCloseTo(SERVO.freeSpeed, 2)
  })
})
