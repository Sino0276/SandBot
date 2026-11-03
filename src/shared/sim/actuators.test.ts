import { describe, expect, it } from 'vitest'
import {
  BRAKE,
  DcGearMotor,
  DEFAULT_VELOCITY_PIDF,
  DUTY_FULL_SCALE,
  FLOAT,
  HubMotorController,
  isServoPortOutput,
  readPidf,
  servoCommand,
  servoTerms,
  sparkMiniStage,
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

  it('BRAKE는 단락 감쇠, FLOAT는 0, 부분 듀티는 명령과 반대 토크를 자른다(회생 없음)', () => {
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

describe('SPARK Mini·서보', () => {
  it('SPARK Mini 펄스: 1000 µs가 최대 듀티, 1490–1510 µs와 PWM 꺼짐은 FLOAT', () => {
    expect(sparkMiniStage({ pulseUs: 2500, pwm: true })).toEqual({ kind: 'duty', duty: 1 })
    expect(sparkMiniStage({ pulseUs: 1000, pwm: true })).toEqual({ kind: 'duty', duty: -0.5 })
    expect(sparkMiniStage({ pulseUs: 1508, pwm: true })).toBe(FLOAT)
    expect(sparkMiniStage({ pulseUs: 2000, pwm: false })).toBe(FLOAT)
    expect(isServoPortOutput({ power: 0, pulseUs: 1500, pwm: true })).toBe(true)
    expect(isServoPortOutput({ mode: 'RUN_WITHOUT_ENCODER', power: 0 })).toBe(false)
  })

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
})
