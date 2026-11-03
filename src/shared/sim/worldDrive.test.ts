import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import { DcGearMotor } from './actuators'
import { resolveServoParams } from './actuatorData'
import {
  DEVICES,
  forwardSign,
  HALF,
  HUB_SIGN,
  ideal,
  LX,
  LY,
  mecanum,
  motorOut,
  outputs,
  pedroDeceleration,
  pedroVelocity,
  perRad,
  RADIUS,
  robotSpec,
  Runner,
  TAG,
  TICK,
  WEIGHT,
  ZERO,
  type Device
} from './driveTestkit'
import { Drivetrain, twistBetween } from './drivetrain'
import { WALL_INNER_HALF } from './field'
import { GRAVITY } from './physics'
import { testMotorParams } from './testkit'
import {
  DEFAULT_WHEEL_FRICTION,
  ROLLING_RESISTANCE,
  WALL_FRICTION,
  wheelSpinInertia
} from './wheelData'
import { distributeWheelLoads } from './wheelLoads'
import type { Pose2, SimJointSpec, SimWheelSpec, WorldSpec } from './worldSpec'

// 구동계 동역학(3c) 시험(spec-3c §4 A의 T0–T17). 기대값은 해석식이나 부등식이다. 기준 로봇은 driveTestkit.ts.

describe('3c 구동계: 미끄럼 없는 극한과 모터', () => {
  it('T0 운동학 극한: μ가 크고 회전 관성이 작고 롤러 점성·굴림 저항이 0이면 정상 상태 변위가 Drivetrain.twist와 같다', () => {
    const spec = robotSpec({ friction: 3, spinInertia: 1e-7, start: { x: 0, y: 0, yaw: 0 } })
    const r = new Runner(spec, { rollerViscous: 0, rollingResistance: 0 })
    const command = mecanum(0.35, 0.25, 0.2)
    // 바퀴마다 듀티가 달라 어떤 바퀴는 명령보다 빨리 끌려 돈다: 그때 VNH5050 비동기 PWM은 전류를 끊어(actuators.ts terminal
    // 'c' 영역) 그 조합의 감쇠가 약하므로 정상 상태까지 몇 초 걸린다(반지름 약 0.5 m 원을 돈다)
    r.run(6, () => outputs(command))
    expect(r.poses.every((p) => !p.blocked)).toBe(true)
    // 정상 상태 창 5–6 s: 바퀴 굴림(엔코더 틱 → m)을 운동학 오라클에 넣은 변위와 실제 변위(SE(2) log)
    const a = 1000
    const b = 1199
    const at = (k: number, device: Device): number => {
      let position = 0
      for (let i = 0; i <= k; i++) {
        const v = r.inputs[i][device]?.position
        if (v !== undefined) position = v as number
      }
      return position
    }
    const rolls = DEVICES.map(
      (device) => (((at(b, device) - at(a, device)) * forwardSign(device)) / perRad(19.2)) * RADIUS
    )
    const oracle = new Drivetrain(spec.wheels).twist(rolls)
    const actual = twistBetween(r.poses[a], r.poses[b])
    // 엔코더 정수 반올림(±1틱 / 약 1000틱)과 SE(2)·필드 축 적분 차 O(h)
    const scale = Math.hypot(actual.dx, actual.dy)
    expect(Math.abs(oracle.dx - actual.dx)).toBeLessThan(2e-3 * scale)
    expect(Math.abs(oracle.dy - actual.dy)).toBeLessThan(2e-3 * scale)
    expect(Math.abs(oracle.dTheta - actual.dTheta)).toBeLessThan(2e-3 * Math.abs(actual.dTheta))
    expect(Math.abs(actual.dTheta)).toBeGreaterThan(0.3)
  })

  it('T1 이상 모터 판의 직진 시간 상수 τ = (M + ΣJ/r²)·r²/Σb(2 %), 붙어 있어 엔코더 = 이동', () => {
    const gearbox = 19.2
    const params = ideal(gearbox)
    const spin = wheelSpinInertia('mecanum', RADIUS, null)
    const spec = robotSpec({ params: ideal, friction: 3 })
    const r = new Runner(spec, { rollingResistance: 0 })
    r.run(0.6, () => outputs(mecanum(1, 0, 0)))
    const dc = new DcGearMotor(params)
    const b = (gearbox * gearbox * dc.torqueConstant * dc.backEmfConstant) / dc.resistance
    const armature = params.rotorInertia * gearbox * gearbox + spin
    const tau = ((13.6 + (4 * armature) / (RADIUS * RADIUS)) * RADIUS * RADIUS) / (4 * b)
    const vFree = params.freeSpeed * RADIUS
    // x(t) = v_f·(t − τ(1 − e^(−t/τ))): T = 0.3 s의 이동에서 τ를 푼다(이분법)
    const T = 0.3
    const travelled = r.poses[60].x - spec.robot.start.x
    let lo = 0.01
    let hi = 1
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      const x = vFree * (T - mid * -Math.expm1(-T / mid))
      if (x > travelled) lo = mid
      else hi = mid
    }
    expect(Math.abs(lo / tau - 1)).toBeLessThan(0.02)
    // 19.2:1·104 mm는 약 0.15 s(method §2.2의 96 mm 0.12 s보다 바퀴가 크다)
    expect(tau).toBeGreaterThan(0.1)
    expect(tau).toBeLessThan(0.2)
    // 미끄럼 없음: 바퀴 굴림 = 이동(정수 틱 안)
    const rolled = (Math.abs(r.value('fl', 'position')) / perRad(gearbox)) * RADIUS
    expect(Math.abs(rolled - (r.pose().x - spec.robot.start.x))).toBeLessThan(
      (2 / perRad(gearbox)) * RADIUS
    )
  })

  it('T11 RUN_USING_ENCODER setVelocity: 바퀴 모터도 허브 속도 PIDF로 목표에 수렴한다(±40 틱/s)', () => {
    const spec = robotSpec()
    const goal = 1500
    const r = new Runner(spec).run(2, () =>
      outputs(
        {},
        {},
        Object.fromEntries(
          DEVICES.map((device) => [
            device,
            motorOut(device, 0, { mode: 'RUN_USING_ENCODER', velocity: goal * forwardSign(device) })
          ])
        )
      )
    )
    for (const device of DEVICES)
      expect(
        Math.abs(r.value(device, 'velocity') * forwardSign(device) - goal)
      ).toBeLessThanOrEqual(40)
    // 붙어서 가므로 몸체 속도 = 바퀴 면 속도
    expect(r.speed(300, 399) / ((goal / perRad(19.2)) * RADIUS)).toBeCloseTo(1, 2)
  })
})

const DT = TICK / 1e9
const LIMIT = WALL_INNER_HALF
const FORWARD_POD = {
  device: 'par',
  position: { x: 0, y: 0.1 },
  measures: 'forward' as const,
  reversed: false,
  ticksPerMeter: 2000
}

// 틱 k의 x 가속(양쪽 틱 자세의 2차 차분, m/s²)
const accelAt = (r: Runner, k: number, axis: 'x' | 'y' = 'x'): number =>
  (r.poses[k + 1][axis] - 2 * r.poses[k][axis] + r.poses[k - 1][axis]) / (DT * DT)

// 바퀴 굴림 거리(m): 원시 허브 틱 → 출력축 각 → 바퀴 면
const rolled = (r: Runner, device: Device, gearbox = 19.2): number =>
  (Math.abs(r.value(device, 'position')) / perRad(gearbox)) * RADIUS

describe('3c 구동계: 견인과 미끄럼', () => {
  it('T2 헛돎: 미끄러지는 동안 차대 가속 = μ·g(메카넘 겉보기 μ, 1 %), 바퀴 엔코더 > 데드휠, 헛돎은 0.1–0.5 s에 끝난다', () => {
    // 무게중심 높이 0: 하중이 같다(가속에 따른 하중 이동이 있으면 하중이 는 뒷바퀴가 먼저 붙어 모터 힘으로 가속이 준다)
    const spec = robotSpec({ comHeight: 0 }, { deadWheels: [FORWARD_POD] })
    // 롤러 점성은 미끄럼 속도에 비례하는 힘을 더하므로 끈다(쿨롱 롤러 몫은 견인 계수에서 뺐으므로 잠근 바퀴 겉보기 μ 그대로다)
    const r = new Runner(spec, { rollerViscous: 0 }).run(1, () => outputs(mecanum(1, 0, 0)))
    const mu = DEFAULT_WHEEL_FRICTION.mecanum
    // 정지에서 power 1: 바퀴 힘 τ_s/r ≈ 46 N가 견인 한계 μ·N ≈ 20 N보다 커서 처음부터 미끄러진다. 차대가 받는 수평 힘은
    // 견인·롤러 상자의 합 Σ (μ_r + c_r)·N_i·cos 45° = μ·W뿐이라 하중 분배·바퀴 관성과 관계없다(method §14 T2 보충)
    for (const k of [2, 10, 20])
      expect(Math.abs(accelAt(r, k) / (mu * GRAVITY) - 1)).toBeLessThan(0.01)
    let end = -1
    for (let k = 2; k < r.poses.length - 1 && end < 0; k++)
      if (accelAt(r, k) < 0.98 * mu * GRAVITY) end = k
    expect(end * DT).toBeGreaterThan(0.1)
    expect(end * DT).toBeLessThan(0.5)
    // 헛돈 만큼 바퀴 엔코더가 데드휠(실제 이동)보다 많이 센다
    const pod = r.value('par', 'position') / FORWARD_POD.ticksPerMeter
    expect(pod).toBeCloseTo(r.pose().x - spec.robot.start.x, 3)
    expect(rolled(r, 'fl') - pod).toBeGreaterThan(0.01)
  })

  it('T2b 일반 바퀴 4륜: 미끄러지는 동안 가속 = 팔각형 마찰의 굴림 방향 지지 cos 22.5°·μ·g(1 %)', () => {
    // 무게중심 높이 0(하중 같음, method §14 T2b)
    const spec = robotSpec({ kind: 'traction', comHeight: 0 })
    const r = new Runner(spec).run(0.2, () => outputs({ fl: 1, fr: 1, bl: 1, br: 1 }))
    // 팔각형 행 넷(0°·45°·90°·135°, 상자 μN/2.6131)의 민코프스키 합은 행 방향에서 (1 + 2·cos 45°)/2.6131 = cos 22.5°(원 안
    // 7.6 %, spec-3c §1.3)
    const mu = DEFAULT_WHEEL_FRICTION.traction
    // 바퀴 면 속도가 모터 힘 = 견인 한계인 속도(약 0.67 m/s)에 닿으면 약 80 ms에 붙는다: 그 전 10–50 ms
    for (const k of [2, 6, 10])
      expect(Math.abs(accelAt(r, k) / (Math.cos(Math.PI / 8) * mu * GRAVITY) - 1)).toBeLessThan(
        0.01
      )
    expect(Math.abs(r.pose().y)).toBeLessThan(1e-9)
  })

  it('T3 메카넘 옆/앞 정상 속도 비: 롤러 저항 0이면 1(1e-6), 기본 값이면 Pedro 기본 로봇에서 0.80 ± 0.05', () => {
    const none = { rollerViscous: 0, rollerCoulomb: 0 }
    expect(Math.abs(pedroVelocity('y', none) / pedroVelocity('x', none) - 1)).toBeLessThan(1e-6)
    const ratio = pedroVelocity('y') / pedroVelocity('x')
    expect(Math.abs(ratio - 0.804)).toBeLessThan(0.05)
  })

  it('T4 FLOAT 관성 주행 감속(Pedro 튜너 절차): 앞 0.88 m/s² ± 25 %, 옆/앞 비 1.8–2.8', () => {
    const forward = pedroDeceleration('x')
    const side = pedroDeceleration('y')
    expect(Math.abs(forward / 0.8796 - 1)).toBeLessThan(0.25)
    expect(side / forward).toBeGreaterThan(1.8)
    expect(side / forward).toBeLessThan(2.8)
  })

  it('T16 정상 옆걸음: 바퀴 엔코더 거리 = 실제 이동(비 1, 미끄럼 강성이 없는 한계로 적은 동작)', () => {
    const spec = robotSpec({ start: { x: 0, y: -1.2, yaw: 0 } })
    const r = new Runner(spec).run(2, () => outputs(mecanum(0, -0.6, 0)))
    const y0 = r.pose().y
    const ticks0 = r.value('fl', 'position')
    r.run(0.8, () => outputs(mecanum(0, -0.6, 0)))
    const travel = r.pose().y - y0
    const wheel = (Math.abs(r.value('fl', 'position') - ticks0) / perRad(19.2)) * RADIUS
    // 정수 틱 반올림(±1 / 약 2800틱)
    expect(Math.abs(wheel / travel - 1)).toBeLessThan(1e-3)
    expect(travel).toBeGreaterThan(0.5)
  })
})

// 앞으로 팔을 뻗은 메커니즘(수직 축 회전 관절이라 중력 토크가 없어 그대로 있다): 피벗 (0.1, 0, 0.3), 무게중심 피벗 앞 0.25 m
const ARM_MASS = 2
function arm(change: Partial<SimJointSpec> = {}): SimJointSpec {
  return {
    parent: -1,
    type: 'revolute',
    origin: { position: { x: 0.1, y: 0, z: 0.3 }, rotation: ZERO },
    axis: { x: 0, y: 0, z: 1 },
    limits: null,
    body: {
      mass: ARM_MASS,
      centerOfMass: { x: 0.25, y: 0, z: 0 },
      inertia: [1e-4, 0.01, 0.01, 0, 0, 0]
    },
    friction: { coulomb: 0, viscous: 0 },
    spring: null,
    drive: { kind: 'none' },
    switches: [],
    ...change
  }
}

describe('3c 구동계: 법선 하중', () => {
  it('T5 정적 하중: 팔을 앞으로 뻗은 무게중심이면 하중이 wheelLoads 해와 1e-9 안이고 로봇이 움직이지 않는다', () => {
    const spec = robotSpec({}, { joints: [arm()] })
    const r = new Runner(spec).run(0.5, () => outputs({}))
    const g = GRAVITY
    const total = (13.6 + ARM_MASS) * g
    // 무게중심: 섀시 (0, 0, 0.1), 팔 (0.35, 0, 0.3)
    const expected = distributeWheelLoads(
      spec.wheels.map((w) => w.position),
      total,
      0,
      -ARM_MASS * g * 0.35
    ).loads
    const loads = r.world.supportLoads()
    loads.forEach((n, i) => expect(Math.abs(n - expected[i])).toBeLessThan(1e-9 * total))
    // 앞바퀴가 더 받는다
    expect(loads[0]).toBeGreaterThan(loads[2] + 5)
    const pose = r.pose()
    expect(Math.abs(pose.x - spec.robot.start.x)).toBeLessThan(1e-12)
    expect(Math.abs(pose.y)).toBeLessThan(1e-12)
    expect(Math.abs(pose.yaw)).toBeLessThan(1e-12)
  })

  it('T5b 동적 하중 이동: 일정 가속(미끄러지는 동안 μ·g) 때 앞바퀴 합의 변화 = −m·a·h/L(2 %)', () => {
    const mu = 0.3
    const height = 0.1
    const spec = robotSpec({ friction: mu, comHeight: height })
    const r = new Runner(spec, { rollerViscous: 0 }).run(0.3, () => outputs(mecanum(1, 0, 0)))
    const a = accelAt(r, r.poses.length - 2)
    expect(Math.abs(a / (mu * GRAVITY) - 1)).toBeLessThan(0.01)
    const loads = r.world.supportLoads()
    const front = loads[0] + loads[1]
    const expected = WEIGHT / 2 - (13.6 * a * height) / (2 * LX)
    expect(Math.abs((front - WEIGHT / 2) / (expected - WEIGHT / 2) - 1)).toBeLessThan(0.02)
  })

  it('T5c 무게중심이 앞·위에 있고 급감속하면 뒷바퀴가 0.1 s 뒤 뜨고(wheelLift 한 번), ZMP가 밖이면 tipping도 한 번', () => {
    const spec = robotSpec({ friction: 2, comX: 0.075, comHeight: 0.3 })
    const r = new Runner(spec).run(1, () => outputs(mecanum(1, 0, 0)))
    expect(r.world.drainNotices()).toEqual([])
    // 전출력에서 BRAKE(power 0, 단자 단락): 약 6 m/s²로 서서 ZMP = 0.075 + 0.3·a/g ≈ 0.27 m가 앞바퀴(0.15 m) 밖이다
    r.run(0.05, () => outputs({}))
    expect(r.world.supportLoads()[2]).toBeLessThan(1e-9)
    // 0.1 s가 지나기 전에는 알리지 않는다
    expect(r.world.drainNotices()).toEqual([])
    r.run(0.55, () => outputs({}))
    const notices = r.world.drainNotices().map((n) => n.code)
    expect(notices.sort()).toEqual(['tipping', 'wheelLift'])
    // 다시 달려 세워도 실행마다 한 번이다
    r.run(1, () => outputs(mecanum(1, 0, 0)))
    r.run(0.6, () => outputs({}))
    expect(r.world.drainNotices()).toEqual([])
  })

  it('T14 1.6 m/s로 벽에 박거나 리프트가 한계에 부딪혀도 거짓 tipping·wheelLift가 없다(걸러진 가속)', () => {
    const spec = robotSpec({ start: { x: -0.6, y: 0, yaw: 0 } })
    const r = new Runner(spec).run(2, () => outputs(mecanum(1, 0, 0)))
    expect(r.poses.some((p) => p.blocked)).toBe(true)
    let before = 0
    for (let k = 1; k < 200; k++) before = Math.max(before, r.speed(k - 1, k))
    expect(before).toBeGreaterThan(1.5)
    expect(r.world.drainNotices()).toEqual([])
    const lifting = robotSpec({}, liftWorld())
    const l = new Runner(lifting).run(1.5, () => ({ ...outputs({}), lift: liftOut(1) }))
    expect(l.pose().joints?.[0]).toBeCloseTo(0.3, 6)
    expect(l.world.drainNotices()).toEqual([])
  })

  it('T15 높은 무게중심(0.5 m)·μ 1.0의 1.6 m/s BRAKE 정지: 뒷바퀴 하중이 하위 단계마다 번갈아 뛰지 않는다', () => {
    const spec = robotSpec({ friction: 1, comHeight: 0.5, start: { x: -1.5, y: 0, yaw: 0 } })
    // 1 ms 틱 = 하위 단계 하나
    const r = new Runner(spec, {}, 1_000_000).run(1.2, () => outputs(mecanum(1, 0, 0)))
    const rear: number[] = []
    r.run(0.8, () => {
      rear.push(r.world.supportLoads()[2])
      return outputs({})
    })
    let run = 0
    let longest = 0
    for (let k = 2; k < rear.length; k++) {
      const flipped = (rear[k] - rear[k - 1]) * (rear[k - 1] - rear[k - 2]) < 0
      run = flipped ? run + 1 : 0
      longest = Math.max(longest, run)
    }
    expect(longest).toBeLessThanOrEqual(10)
    expect(r.speed(r.poses.length - 11, r.poses.length - 1)).toBeLessThan(0.01)
  })
})

// 리프트(직선 관절 위로, 1.5 kg, 0–0.3 m)를 구동하는 goBILDA 312 모터
const LIFT_PARAMS = testMotorParams(TAG, 19.2)
function liftWorld(): Partial<WorldSpec> {
  const base = robotSpec()
  return {
    motors: [
      ...base.motors,
      { device: 'lift', modelTag: TAG, gearbox: 19.2, directionSign: 1, params: LIFT_PARAMS }
    ],
    joints: [
      {
        parent: -1,
        type: 'prismatic',
        origin: { position: { x: 0, y: 0, z: 0.1 }, rotation: ZERO },
        axis: { x: 0, y: 0, z: 1 },
        limits: { lower: 0, upper: 0.3 },
        body: { mass: 1.5, centerOfMass: ZERO, inertia: [1e-3, 1e-3, 1e-3, 0, 0, 0] },
        friction: { coulomb: 1, viscous: 0 },
        spring: null,
        drive: {
          kind: 'motor',
          devices: ['lift'],
          ratio: 0.112 / (2 * Math.PI),
          params: LIFT_PARAMS,
          rigging: { kind: 'direct' }
        },
        switches: []
      }
    ]
  }
}
const liftOut = (power: number): DeviceValues => ({
  mode: 'RUN_WITHOUT_ENCODER',
  power: power * HUB_SIGN,
  enabled: true,
  zeroPower: 'BRAKE',
  encoderOffset: 0
})

describe('3c 구동계: 벽', () => {
  const touching = { x: LIMIT - HALF, y: 0, yaw: 0 }

  it('T6 벽 밀기·마찰: 옆/앞 힘 비가 벽 μ보다 작으면 옆으로 미끄러지지 않고, 크면 미끄러진다. blocked, 데드휠 앞 성분 0', () => {
    // μ 2: 바퀴는 헛돌지 않는다. 막힌 채면 바퀴 힘이 듀티에 비례하고(정지 토크 직선) 메카넘 앞·옆 정지 힘 비 = 듀티 비(p_s/p_f)
    const slide = (side: number): { dy: number; pod: number; blocked: boolean } => {
      const spec = robotSpec({ friction: 2, start: touching }, { deadWheels: [FORWARD_POD] })
      const r = new Runner(spec).run(0.6, () => outputs(mecanum(0.6, side, 0)))
      return {
        dy: Math.abs(r.pose().y),
        pod: r.value('par', 'position'),
        blocked: r.poses.slice(5).every((p) => p.blocked)
      }
    }
    const stick = slide(0.15)
    expect(0.15 / 0.6).toBeLessThan(WALL_FRICTION)
    expect(stick.dy).toBeLessThan(1e-6)
    expect(stick.blocked).toBe(true)
    expect(stick.pod).toBe(0)
    // 막힌 바퀴 좌표의 정지 마찰 상자(기어 손실·모터 쿨롱·굴림 저항)가 옆 힘 일부를 먹으므로 경계보다 넉넉히 넘긴다
    const slip = slide(0.5)
    expect(0.5 / 0.6).toBeGreaterThan(WALL_FRICTION)
    expect(slip.dy).toBeGreaterThan(0.02)
    expect(slip.blocked).toBe(true)
    expect(slip.pod).toBe(0)
  })

  it('T6b 벽 헛돎: 전출력이면 바퀴 엔코더가 계속 늘고 데드휠은 0, power 0.3이면 모터가 막혀 엔코더가 서고 전류가 d·V/R', () => {
    const spec = robotSpec({ start: touching }, { deadWheels: [FORWARD_POD] })
    const full = new Runner(spec).run(0.5, () => outputs(mecanum(1, 0, 0)))
    const ticks = full.value('fl', 'position')
    full.run(0.5, () => outputs(mecanum(1, 0, 0)))
    expect(Math.abs(full.value('fl', 'position') - ticks)).toBeGreaterThan(500)
    expect(full.value('par', 'position')).toBe(0)
    const weak = new Runner(spec).run(0.5, () => outputs(mecanum(0.3, 0, 0)))
    const held = weak.value('fl', 'position')
    weak.run(0.5, () => outputs(mecanum(0.3, 0, 0)))
    expect(Math.abs(weak.value('fl', 'position') - held)).toBeLessThanOrEqual(1)
    expect(weak.value('par', 'position')).toBe(0)
    // 멈춘 모터: 역기전력 0이라 단자 전류 = 0.3·V/R = 0.3·정지 전류(12 V)
    const stall = LIFT_PARAMS.stallCurrent * 0.3
    expect(Math.abs(weak.value('fl', 'current') / stall - 1)).toBeLessThan(0.02)
  })

  it('T6c 걸친 시작: 꼭짓점이 1 cm 침투한 채 정지하면 자세가 1e-9 안 그대로다', () => {
    const yaw = 0.1
    const reach = HALF * (Math.cos(yaw) + Math.sin(yaw))
    const start = { x: LIMIT + 0.01 - reach, y: 0.3, yaw }
    const spec = robotSpec({ start })
    const r = new Runner(spec).run(1, () => outputs({}))
    const pose = r.pose()
    expect(Math.abs(pose.x - start.x)).toBeLessThan(1e-9)
    expect(Math.abs(pose.y - start.y)).toBeLessThan(1e-9)
    expect(Math.abs(pose.yaw - start.yaw)).toBeLessThan(1e-9)
    // 밀어도 더 들어가지 않는다(침투 증가 1e-6 m 아래)
    r.run(0.5, () => outputs(mecanum(0.5, 0, 0)))
    const c = Math.cos(r.pose().yaw)
    const s = Math.sin(r.pose().yaw)
    const corners = [
      [HALF, HALF],
      [HALF, -HALF]
    ].map(([x, y]) => r.pose().x + c * x - s * y)
    expect(Math.max(...corners) - LIMIT).toBeLessThan(0.01 + 1e-6)
  })

  it('T17 벽 밀기 경계: power 0.5로 밀 때 바퀴 미끄럼 여부가 해석식(바퀴 힘 대 μ·N)과 맞는다', () => {
    // 막힌 바퀴가 미끄러지기 시작하는 힘: (정지 토크·d·V/12 − G·τ_c)/r − 굴림 저항 c_rr·N(바퀴가 돌면 상자가 찬다). 메카넘 한
    // 바퀴가 앞으로 내는 견인 한계는 μ_r·N·cos 45° = μ·N(겉보기 μ). 벽 힘은 바닥 높이라 하중 이동이 없어 N = W/4.
    const dc = new DcGearMotor(LIFT_PARAMS)
    const n = WEIGHT / 4
    const force =
      (LIFT_PARAMS.stallTorque * 0.5 - dc.gearbox * dc.coulomb) / RADIUS - ROLLING_RESISTANCE * n
    const threshold = force / n
    const spins = (mu: number): number => {
      const spec = robotSpec({ friction: mu, start: touching })
      const r = new Runner(spec).run(0.5, () => outputs(mecanum(0.5, 0, 0)))
      const before = r.value('fl', 'position')
      r.run(0.5, () => outputs(mecanum(0.5, 0, 0)))
      return Math.abs(r.value('fl', 'position') - before)
    }
    expect(threshold).toBeGreaterThan(0.5)
    expect(threshold).toBeLessThan(0.8)
    // 경계 아래면 미끄러져 돈다(남는 힘 0.05·N에서 역기전력이 맞서는 속도까지), 위면 막힌다
    expect(spins(threshold - 0.05)).toBeGreaterThan(20)
    expect(spins(threshold + 0.05)).toBeLessThanOrEqual(1)
  })
})

describe('3c 구동계: 결합·정지·결정성·성능', () => {
  it('T7 팔 반력: 바닥 μ = 0이면 서보로 팔을 휘둘러도 계 무게중심이 거의 그대로다(속도 암시 오일러의 O(h))', () => {
    const servo = resolveServoParams('gobildaTorque', 'servo')
    const spec = robotSpec(
      { kind: 'traction', friction: 0, start: { x: 0, y: 0, yaw: 0 } },
      {
        joints: [
          arm({
            drive: {
              kind: 'servo',
              device: 'arm',
              ratio: 1,
              params: servo,
              zeroPulseUs: 1500,
              direction: 1
            }
          })
        ]
      }
    )
    const r = new Runner(spec).run(2, (k) => ({
      ...outputs({}),
      arm: { pwm: true, pulseUs: Math.floor(k / 60) % 2 === 0 ? 2100 : 900 }
    }))
    const com = (pose: Pose2, q: number): number[] => {
      const c = Math.cos(pose.yaw)
      const s = Math.sin(pose.yaw)
      // 팔 무게중심(로봇 좌표): 피벗 (0.1, 0) + R_z(q)·(0.25, 0)
      const ax = 0.1 + 0.25 * Math.cos(q)
      const ay = 0.25 * Math.sin(q)
      const armX = pose.x + c * ax - s * ay
      const armY = pose.y + s * ax + c * ay
      const total = 13.6 + ARM_MASS
      return [(13.6 * pose.x + ARM_MASS * armX) / total, (13.6 * pose.y + ARM_MASS * armY) / total]
    }
    const first = com(r.poses[0], r.poses[0].joints?.[0] ?? 0)
    const swing = Math.max(...r.poses.map((p) => Math.abs(p.joints?.[0] ?? 0)))
    expect(swing).toBeGreaterThan(0.5)
    for (const pose of r.poses) {
      const now = com(pose, pose.joints?.[0] ?? 0)
      expect(Math.hypot(now[0] - first[0], now[1] - first[1])).toBeLessThan(1e-4)
    }
    // 섀시는 반대로 움직이고 돈다
    expect(Math.abs(r.pose().yaw) + Math.abs(r.pose().y)).toBeGreaterThan(1e-3)
  })

  it('T7b 급정거하면 매달린 자유 팔이 앞으로 흔들린다(기저 감속의 관성력)', () => {
    const pendulum: SimJointSpec = {
      ...arm(),
      origin: { position: { x: 0, y: 0, z: 0.4 }, rotation: ZERO },
      axis: { x: 0, y: 1, z: 0 },
      body: {
        mass: 0.5,
        centerOfMass: { x: 0, y: 0, z: -0.2 },
        inertia: [2e-3, 2e-3, 1e-5, 0, 0, 0]
      },
      friction: { coulomb: 0, viscous: 0.02 }
    }
    const spec = robotSpec({ start: { x: -1.5, y: 0, yaw: 0 } }, { joints: [pendulum] })
    const r = new Runner(spec).run(1, () => outputs(mecanum(1, 0, 0)))
    const cruising = r.pose().joints?.[0] ?? 0
    r.run(0.5, () => outputs({}))
    // R_y(q)·(0, 0, −L) = (−L·sin q, 0, −L·cos q): 앞(+x)으로 흔들리면 q < 0
    const braking = r.poses.slice(200).map((p) => p.joints?.[0] ?? 0)
    expect(Math.min(...braking)).toBeLessThan(cruising - 0.05)
  })

  it('T8 FLOAT 관성 주행: 마찰이 있으면 속도가 단조롭게 준다', () => {
    const spec = robotSpec({ start: { x: -1.5, y: 0, yaw: 0 } })
    const r = new Runner(spec).run(0.8, () => outputs(mecanum(1, 0, 0)))
    const cut = r.k
    r.run(1.5, () => outputs({}, { zeroPower: 'FLOAT' }))
    let last = Infinity
    for (let k = cut + 1; k < r.poses.length; k++) {
      const v = r.speed(k - 1, k)
      expect(v).toBeLessThanOrEqual(last + 1e-9)
      last = v
    }
    expect(last).toBeLessThan(r.speed(cut - 1, cut))
  })

  it('T9 BRAKE로 선 로봇을 오래 두면 엔코더·데드휠 정수 값이 그대로이고 자세 변화 < 1e-9', () => {
    const spec = robotSpec({ start: { x: -1, y: 0, yaw: 0 } }, { deadWheels: [FORWARD_POD] })
    const r = new Runner(spec).run(0.5, () => outputs(mecanum(0.5, 0.2, 0.1)))
    r.run(1.5, () => outputs({}))
    const pose = r.pose()
    const values = [...DEVICES, 'par'].map((d) => r.value(d, 'position'))
    r.run(5, () => outputs({}))
    expect([...DEVICES, 'par'].map((d) => r.value(d, 'position'))).toEqual(values)
    expect(Math.abs(r.pose().x - pose.x)).toBeLessThan(1e-9)
    expect(Math.abs(r.pose().y - pose.y)).toBeLessThan(1e-9)
    expect(Math.abs(r.pose().yaw - pose.yaw)).toBeLessThan(1e-9)
  })

  it('T10 결정성: 바퀴·관절·벽이 있는 세계도 같은 출력열이면 입력열·자세가 바이트까지 같다', () => {
    const scenario = (): string => {
      const spec = robotSpec(
        { start: { x: 1.2, y: 0.5, yaw: 0.3 } },
        { ...liftWorld(), otos: [{ device: 'otos', position: { x: 0.1, y: 0 }, mountingAngle: 0 }] }
      )
      const r = new Runner(spec).run(2, (k) => ({
        ...outputs(mecanum(Math.sin(k / 40), 0.4 * Math.cos(k / 70), 0.3 * Math.sin(k / 25))),
        lift: liftOut(k < 200 ? 1 : -0.5)
      }))
      return JSON.stringify([r.inputs, r.poses, r.world.drainNotices()])
    }
    const text = scenario()
    expect(scenario()).toBe(text)
    expect(text).not.toContain('null')
  })

  it('T12 6륜 체인: 한 모터가 바퀴 셋을 돌리는 탱크가 앞으로 가고 제자리에서 돈다', () => {
    const wheel = (x: number, y: number, motor: string): SimWheelSpec => ({
      position: { x, y },
      angle: 0,
      kind: 'traction',
      rollers: null,
      radius: RADIUS,
      gearRatio: 1,
      motor,
      spinInertia: wheelSpinInertia('traction', RADIUS, null),
      friction: DEFAULT_WHEEL_FRICTION.traction
    })
    const base = robotSpec({ start: { x: 0, y: 0, yaw: 0 } })
    const spec: WorldSpec = {
      ...base,
      motors: [
        { device: 'left', modelTag: TAG, gearbox: 19.2, directionSign: -1, params: LIFT_PARAMS },
        { device: 'right', modelTag: TAG, gearbox: 19.2, directionSign: 1, params: LIFT_PARAMS }
      ],
      wheels: [0.15, 0, -0.15].flatMap((x) => [wheel(x, LY, 'left'), wheel(x, -LY, 'right')])
    }
    const tank = (left: number, right: number): Record<string, DeviceValues> => ({
      left: { ...motorOut('fl', 0), power: left * HUB_SIGN * -1 },
      right: { ...motorOut('fr', 0), power: right * HUB_SIGN }
    })
    const straight = new Runner(spec).run(1, () => tank(0.5, 0.5))
    expect(straight.pose().x).toBeGreaterThan(0.3)
    expect(Math.abs(straight.pose().yaw)).toBeLessThan(1e-6)
    // 바퀴 여섯이 모두 옆으로 미끄러져야 돌므로 전출력이다
    const turn = new Runner(spec).run(1, () => tank(-1, 1))
    expect(turn.pose().yaw).toBeGreaterThan(0.2)
    expect(Math.hypot(turn.pose().x, turn.pose().y)).toBeLessThan(0.01)
  })

  it('T13 성능: 메카넘 4 + 관절 3 + 벽 접촉의 하위 단계당 중앙값(로그, CI 상한 5 ms)', () => {
    const lift = liftWorld()
    const stage = (lift.joints as SimJointSpec[])[0]
    const spec = robotSpec(
      { start: { x: LIMIT - HALF - 0.02, y: 0.2, yaw: 0.05 } },
      {
        motors: lift.motors,
        joints: [
          stage,
          { ...stage, parent: 0, drive: { kind: 'none' }, limits: { lower: 0, upper: 0.25 } },
          arm({ parent: 1, origin: { position: { x: 0.1, y: 0, z: 0.05 }, rotation: ZERO } })
        ]
      }
    )
    const r = new Runner(spec)
    const times: number[] = []
    for (let k = 0; k < 400; k++) {
      const start = performance.now()
      r.run(DT, () => ({ ...outputs(mecanum(0.6, 0.2, 0.05)), lift: liftOut(k < 200 ? 1 : -0.3) }))
      if (k > 0) times.push((performance.now() - start) / 5)
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]
    console.info(`3c 성능: 하위 단계당 중앙값 ${median.toFixed(3)} ms (메카넘 4 + 관절 3 + 벽)`)
    expect(r.poses.some((p) => p.blocked)).toBe(true)
    expect(median).toBeLessThan(5)
  })
})
