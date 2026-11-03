import { describe, expect, it } from 'vitest'
import {
  BODY_DIODE_DROP,
  BRAKE,
  DcGearMotor,
  DEFAULT_VELOCITY_PIDF,
  DUTY_FULL_SCALE,
  FLOAT,
  HubMotorController,
  readPidf,
  servoCommand,
  servoPositionPulseUs,
  servoTerms,
  type ControlInputs
} from './actuators'
import type { DeviceValues } from '../sidecarProtocol'
import { readMotorOutputs, type MotorOutputs } from './motorModel'
import type { SimMotorParams, SimServoParams } from './worldSpec'

// goBILDA 5203 19.2:1(312 RPM) 데이터시트([ACT] §2.1): 2.383 N·m, 9.2 A, 0.25 A, 정확한 비 19.2032, 효율 0.95²(spec-3b §1.2)
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

// goBILDA 25-2 Torque 허브 5 V([ACT] §5.2·§5.3): 1.76 N·m, 4.33 rad/s, 270°, 데드밴드 4 µs, kp = τs/5°
const SERVO: SimServoParams = {
  stallTorque: 1.76,
  freeSpeed: 4.33,
  rangeAngle: (270 * Math.PI) / 180,
  deadbandUs: 4,
  kp: 1.76 / ((5 * Math.PI) / 180),
  kd: 0.05,
  crFullPower: 0.667,
  limpFriction: 0.05
}

describe('DcGearMotor', () => {
  const motor = new DcGearMotor(PARAMS)
  const g = PARAMS.gearbox

  it('데이터시트로 R·Kt·Ke를 정하고 정지 토크와 무부하 전류에 맞는다', () => {
    expect(motor.resistance).toBeCloseTo(12 / 9.2, 12)
    // 12 V 정지: η·G·Kt·I_stall = 정지 토크
    expect(PARAMS.efficiency * g * motor.torqueConstant * PARAMS.stallCurrent).toBeCloseTo(
      2.383,
      12
    )
    // 12 V 무부하 속도: 전류 = I_free
    expect(motor.current({ kind: 'duty', duty: 1 }, 12, PARAMS.freeSpeed)).toBeCloseTo(0.25, 12)
    // 무부하 속도에서 모터가 미는 토크(효율 뒤) = 마찰(쿨롱 + 점성)
    const terms = motor.terms({ kind: 'duty', duty: 1 }, 12, PARAMS.freeSpeed)
    const shaft = (PARAMS.efficiency * (terms.force - terms.damping * PARAMS.freeSpeed)) / g
    expect(shaft).toBeCloseTo(motor.coulomb + motor.viscous * PARAMS.freeSpeed * g, 12)
  })

  it('BRAKE는 단락 감쇠, FLOAT는 레일 아래 0, 부분 듀티는 명령과 반대 토크를 자른다(레일 아래 회생 없음)', () => {
    const k = (g * g * motor.torqueConstant * motor.backEmfConstant) / motor.resistance
    expect(motor.terms(BRAKE, 12, 1)).toEqual({ force: 0, damping: k, region: 'b' })
    expect(motor.terms(FLOAT, 12, 1)).toEqual({ force: 0, damping: 0, region: 'f' })
    // 듀티 0.3에서 무부하 속도의 0.3배보다 빠르면 자른다
    expect(motor.terms({ kind: 'duty', duty: 0.3 }, 12, 0.31 * PARAMS.freeSpeed).region).toBe('c')
    expect(motor.current({ kind: 'duty', duty: 0.3 }, 12, 0.31 * PARAMS.freeSpeed)).toBe(0)
    expect(motor.terms({ kind: 'duty', duty: 0.3 }, 12, 0.2 * PARAMS.freeSpeed).region).toBe('l')
    // 듀티 1은 꺼짐 구간이 없어 그대로(역전류)
    expect(motor.terms({ kind: 'duty', duty: 1 }, 12, 1.2 * PARAMS.freeSpeed).region).toBe('l')
    expect(motor.current({ kind: 'duty', duty: 1 }, 12, 1.2 * PARAMS.freeSpeed)).toBeLessThan(0)
  })

  it('역기전력이 배터리 전압 + 본체 다이오드 강하를 넘으면 회생 제동한다(FLOAT·듀티 0은 다이오드 둘, 부분 듀티의 꺼짐 구간은 하나)', () => {
    const k = (g * g * motor.torqueConstant * motor.backEmfConstant) / motor.resistance
    const vf = BODY_DIODE_DROP
    expect(vf).toBe(0.7)
    // 역기전력이 e가 되는 출력축 속도
    const at = (e: number): number => e / (motor.backEmfConstant * g)
    const torque = (t: ReturnType<typeof motor.terms>, omega: number): number =>
      t.force - t.damping * omega
    for (const [stage, region, clamp] of [
      [FLOAT, 'F', 12 + 2 * vf],
      [{ kind: 'duty', duty: 0 }, 'z', 12 + 2 * vf],
      // 켜짐 구간(|d|)은 FET로 레일 V, 꺼짐 구간(1 − |d|)은 다이오드 하나로 V + Vf: 평균 V + (1 − |d|)·Vf
      [{ kind: 'duty', duty: 0.3 }, 'g', 12 + 0.7 * vf],
      [{ kind: 'duty', duty: 0.99 }, 'g', 12 + 0.01 * vf]
    ] as const) {
      // 묶이는 전압 바로 아래(레일 위여도)는 전류 0, 위는 (u − e)/R의 회생(제동, ω 반대 토크)
      expect(motor.current(stage, 12, at(12.0001))).toBe(0)
      expect(motor.current(stage, 12, at(clamp * 0.9999))).toBe(0)
      const omega = at(clamp * 1.3)
      const above = motor.terms(stage, 12, omega)
      expect(above.region).toBe(region)
      expect(above.damping).toBeCloseTo(k, 12)
      expect(torque(above, omega)).toBeLessThan(0)
      expect(motor.current(stage, 12, omega)).toBeCloseTo(
        (clamp - motor.backEmfConstant * g * omega) / motor.resistance,
        12
      )
      // 거꾸로 돌려져도 같다(대칭: FLOAT·듀티 0은 −(V + 2Vf), 부분 듀티는 명령 쪽이 아니면 선형)
      if (stage.kind !== 'duty' || stage.duty === 0)
        expect(torque(motor.terms(stage, 12, -omega), -omega)).toBeCloseTo(
          -torque(above, omega),
          12
        )
    }
    // 듀티 1은 꺼짐 구간이 없어 레일 V 그대로이고, 듀티 0.99는 레일 위에서 거의 같다(차이 0.01·Vf)
    for (const omega of [at(13), at(18), at(36)]) {
      const near = torque(motor.terms({ kind: 'duty', duty: 0.99 }, 12, omega), omega)
      const one = torque(motor.terms({ kind: 'duty', duty: 1 }, 12, omega), omega)
      expect(Math.abs(near - one)).toBeLessThanOrEqual(
        ((0.01 * vf * g * motor.torqueConstant) / motor.resistance) * (1 + 1e-9)
      )
    }
    // 영역 경계를 지나도 토크가 연속이다
    for (const [stage, edges] of [
      [FLOAT, [12 + 2 * vf]],
      [{ kind: 'duty', duty: 0.5 }, [6, 12 + 0.5 * vf]],
      [{ kind: 'duty', duty: 0.99 }, [0.99 * 12, 12 + 0.01 * vf]]
    ] as const)
      for (const e of edges) {
        const lo = at(e) * (1 - 1e-9)
        const hi = at(e) * (1 + 1e-9)
        const below = torque(motor.terms(stage, 12, lo), lo)
        const above = torque(motor.terms(stage, 12, hi), hi)
        expect(Math.abs(below - above)).toBeLessThan(1e-6)
      }
  })
})

describe('HubMotorController', () => {
  const out = (change: Record<string, unknown>): MotorOutputs =>
    readMotorOutputs({
      mode: 'RUN_USING_ENCODER',
      power: 0.5,
      velocity: 1000,
      enabled: true,
      zeroPower: 'BRAKE',
      targetPosition: null,
      encoderOffset: 0,
      encoderResets: 0,
      ...change
    } as Record<string, number | string | boolean | null>)

  it('RUN_WITHOUT_ENCODER는 power가 곧 듀티이고 0이면 zeroPower, 꺼지면 FLOAT', () => {
    const c = new HubMotorController()
    expect(c.stage(out({ mode: 'RUN_WITHOUT_ENCODER', power: -0.4 }))).toEqual({
      kind: 'duty',
      duty: -0.4
    })
    expect(c.stage(out({ mode: 'RUN_WITHOUT_ENCODER', power: 0 }))).toBe(BRAKE)
    expect(c.stage(out({ mode: 'RUN_WITHOUT_ENCODER', power: 0, zeroPower: 'FLOAT' }))).toBe(FLOAT)
    expect(c.stage(out({ enabled: false }))).toBe(FLOAT)
    expect(c.stage(out({ mode: 'STOP_AND_RESET_ENCODER' }))).toBe(BRAKE)
  })

  it('속도 루프: 주기마다 적분을 더하고(P·e + ΣI·e), 32767에서 자르며 넘친 만큼 적분에서 뺀다', () => {
    const c = new HubMotorController()
    const input = (velocity: number): ControlInputs => ({
      out: out({}),
      velocityPidf: DEFAULT_VELOCITY_PIDF,
      positionPidf: DEFAULT_VELOCITY_PIDF,
      position: 0,
      velocity,
      rawTarget: null
    })
    c.sample(input(900))
    // e = 100: P·e + I·e = 1000 + 300
    expect(c.duty).toBeCloseTo(1300 / DUTY_FULL_SCALE, 12)
    c.sample(input(900))
    expect(c.duty).toBeCloseTo(1600 / DUTY_FULL_SCALE, 12)
    // 큰 오차: 자른다
    c.sample(input(-5000))
    expect(c.duty).toBe(1)
    expect(c.stage(out({}))).toEqual({ kind: 'duty', duty: 1 })
    // 모드가 바뀌면 적분을 지운다
    c.sample({ ...input(900), out: out({ mode: 'RUN_WITHOUT_ENCODER' }) })
    expect(c.duty).toBe(0)
    c.sample(input(900))
    expect(c.duty).toBeCloseTo(1300 / DUTY_FULL_SCALE, 12)
  })

  it('RUN_TO_POSITION은 위치 P로 목표 속도를 정하고 |velocity|로 자른다(위치 I·D·F는 쓰지 않는다)', () => {
    const c = new HubMotorController()
    c.sample({
      out: out({ mode: 'RUN_TO_POSITION', velocity: 300, targetPosition: 100 }),
      velocityPidf: [1, 0, 0, 0],
      positionPidf: [10, 5, 5, 5],
      position: 90,
      velocity: 0,
      rawTarget: 100
    })
    // 목표 속도 = min(10·10, 300) = 100, 듀티 = P·e = 100
    expect(c.duty).toBeCloseTo(100 / DUTY_FULL_SCALE, 12)
    c.sample({
      out: out({ mode: 'RUN_TO_POSITION', velocity: -50, targetPosition: 100 }),
      velocityPidf: [1, 0, 0, 0],
      positionPidf: [10, 0, 0, 0],
      position: 90,
      velocity: 0,
      rawTarget: 100
    })
    expect(c.duty).toBeCloseTo(50 / DUTY_FULL_SCALE, 12)
  })

  it('PIDF는 출력의 [p, i, d, f] 배열이고, 모양이 틀리면 기본값', () => {
    const values = (v: unknown): DeviceValues => ({ velocityPidf: v as number })
    expect(readPidf(values([1, 2, 3, 4]), 'velocityPidf', DEFAULT_VELOCITY_PIDF)).toEqual([
      1, 2, 3, 4
    ])
    expect(readPidf(values([1, 2, 3]), 'velocityPidf', DEFAULT_VELOCITY_PIDF)).toBe(
      DEFAULT_VELOCITY_PIDF
    )
    expect(readPidf(values([1, 2, 3, Infinity]), 'velocityPidf', DEFAULT_VELOCITY_PIDF)).toBe(
      DEFAULT_VELOCITY_PIDF
    )
    expect(readPidf(undefined, 'velocityPidf', DEFAULT_VELOCITY_PIDF)).toBe(DEFAULT_VELOCITY_PIDF)
  })
})

describe('서보', () => {
  it('서보 펄스 → 각(1500 µs가 0, 600–2400 µs = rangeAngle), PWM이 꺼지면 풀림', () => {
    expect(servoCommand({ pulseUs: 2400, pwm: true }, SERVO, false)).toEqual({
      kind: 'position',
      angle: SERVO.rangeAngle / 2
    })
    expect(servoCommand({ pulseUs: 1500, pwm: false }, SERVO, false)).toEqual({ kind: 'limp' })
    expect(servoCommand({ pulseUs: null, pwm: true }, SERVO, false)).toEqual({ kind: 'limp' })
    // CR: 2100 µs면 goBILDA 25-2(900–2100 µs) 최대, 데드밴드 반폭(2 µs) 안은 0
    const cr = servoCommand({ pulseUs: 2100, pwm: true }, SERVO, true)
    expect(cr.kind === 'speed' && cr.fraction).toBeCloseTo(600 / (900 * 0.667), 12)
    expect(servoCommand({ pulseUs: 1502, pwm: true }, SERVO, true)).toEqual({
      kind: 'speed',
      fraction: 0
    })
  })

  it('편집 자세의 펄스와 방향: 각 = direction × (펄스 − zeroPulseUs) × rangeAngle/1800 µs, CR은 방향만', () => {
    expect(servoPositionPulseUs(0)).toBe(600)
    expect(servoPositionPulseUs(0.35)).toBeCloseTo(1230, 9)
    expect(servoPositionPulseUs(1)).toBe(2400)
    const at = (pulseUs: number, zero: number, direction: 1 | -1): number => {
      const c = servoCommand({ pulseUs, pwm: true }, SERVO, false, zero, direction)
      return c.kind === 'position' ? c.angle : NaN
    }
    expect(at(1230, 1230, 1)).toBe(0)
    expect(at(1500, 1230, 1)).toBeCloseTo((270 / 1800) * SERVO.rangeAngle, 12)
    expect(at(1500, 1230, -1)).toBeCloseTo((-270 / 1800) * SERVO.rangeAngle, 12)
    // 허브 출력 범위 밖은 자른다(편집 자세와 관계없이)
    expect(at(3000, 1500, 1)).toBeCloseTo((1000 / 1800) * SERVO.rangeAngle, 12)
    // CR: 정지는 늘 1500 µs(zeroPulseUs를 쓰지 않음), 방향만 뒤집는다
    const cr = servoCommand({ pulseUs: 2100, pwm: true }, SERVO, true, 1230, -1)
    expect(cr.kind === 'speed' && cr.fraction).toBeCloseTo(-600 / (900 * 0.667), 12)
    expect(servoCommand({ pulseUs: 1500, pwm: true }, SERVO, true, 1230, -1)).toEqual({
      kind: 'speed',
      fraction: 0
    })
  })

  it('서보 PD는 모터 직선으로 잘린다(정지 토크·무부하 속도)', () => {
    const far = servoTerms({ kind: 'position', angle: 1 }, SERVO, 0, 0)
    expect(far).toMatchObject({ force: SERVO.stallTorque, stiffness: 0, region: 'h' })
    expect(far.damping).toBeCloseTo(SERVO.stallTorque / SERVO.freeSpeed, 12)
    const near = servoTerms({ kind: 'position', angle: 0.02 }, SERVO, 0, 0)
    expect(near.region).toBe('p')
    expect(near.stiffness).toBe(SERVO.kp)
    expect(servoTerms({ kind: 'position', angle: 0.001 }, SERVO, 0, 0).region).toBe('d')
    expect(servoTerms({ kind: 'limp' }, SERVO, 0, 0)).toMatchObject({ force: 0, friction: 0.05 })
  })

  it('역구동되면 출력은 정지 토크 ±τs에서 멈춘다(CR 서보·위치 서보, spec-3b §1.9)', () => {
    const ts = SERVO.stallTorque
    const wf = SERVO.freeSpeed
    // 출력 τ = force − damping·ω
    const torque = (t: ReturnType<typeof servoTerms>, omega: number): number =>
      t.force - t.damping * omega
    // CR: 전진 명령인데 부하가 무부하 속도로 거꾸로 돌리면 직선은 2τs지만 τs로 자른다. 잘린 토크는 그 속도에서 선형화해
    // 감쇠(τs/ωf)를 암시 항에 둔다(일정 토크가 아님): 그 속도에서 정확히 τs, 더 빨리 돌면 덜 민다
    const slope = ts / wf
    const back = servoTerms({ kind: 'speed', fraction: 1 }, SERVO, 0, -wf)
    expect(back.region).toBe('H')
    expect(back.damping).toBeCloseTo(slope, 12)
    expect(torque(back, -wf)).toBeCloseTo(ts, 12)
    expect(torque(back, -0.5 * wf)).toBeCloseTo(0.5 * ts, 12)
    const backNeg = servoTerms({ kind: 'speed', fraction: -1 }, SERVO, 0, 0.5 * wf)
    expect(backNeg.region).toBe('N')
    expect(backNeg.damping).toBeCloseTo(slope, 12)
    expect(torque(backNeg, 0.5 * wf)).toBeCloseTo(-ts, 12)
    // 직선과 만나는 경계(u = −1에서 ω = 0)에서 연속
    const edge = servoTerms({ kind: 'speed', fraction: -1 }, SERVO, 0, 1e-12)
    expect(torque(edge, 1e-12)).toBeCloseTo(
      torque(servoTerms({ kind: 'speed', fraction: -1 }, SERVO, 0, -1e-12), -1e-12),
      9
    )
    // 명령 방향으로 도는 동안은 직선 그대로(무부하 속도에서 0)
    const forward = servoTerms({ kind: 'speed', fraction: 1 }, SERVO, 0, 0.5 * wf)
    expect(forward.region).toBe('r')
    expect(torque(forward, 0.5 * wf)).toBeCloseTo(0.5 * ts, 12)
    expect(
      torque(servoTerms({ kind: 'speed', fraction: 0.5 }, SERVO, 0, -0.4 * wf), -0.4 * wf)
    ).toBeCloseTo(0.9 * ts, 12)
    // 위치 서보도 같다: 목표가 멀고 거꾸로 돌려지면 τs
    const pos = servoTerms({ kind: 'position', angle: 1 }, SERVO, 0, -0.5 * wf)
    expect(pos.region).toBe('H')
    expect(torque(pos, -0.5 * wf)).toBeCloseTo(ts, 12)
    for (const omega of [-2 * wf, -wf, -0.1, 0, 0.1, wf, 2 * wf])
      for (const command of [
        { kind: 'speed', fraction: 1 },
        { kind: 'speed', fraction: -1 },
        { kind: 'position', angle: 1 },
        { kind: 'position', angle: -1 }
      ] as const) {
        const t = servoTerms(command, SERVO, 0, omega)
        expect(Math.abs(torque(t, omega))).toBeLessThanOrEqual(ts * (1 + 1e-12))
      }
  })
})
