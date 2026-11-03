import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERVO_MODEL,
  jointEncoderTicksPerOutputRev,
  MAX_FREE_SPEED_OVERRIDE_RPM,
  MAX_STALL_TORQUE_OVERRIDE,
  MIN_FREE_SPEED_OVERRIDE_RPM,
  MIN_STALL_TORQUE_OVERRIDE,
  resolveMotorParams,
  resolveServoParams,
  SERVO_MODEL_KEYS
} from './actuatorData'
import { MOTOR_TYPES } from './motorTypes'

const KGCM = 0.0980665
const RPM = (2 * Math.PI) / 60

describe('기어모터 물리 값', () => {
  it('goBILDA 표의 감속비는 제조사 값 그대로다(반올림한 감속비도 받는다)', () => {
    const params = resolveMotorParams('goBILDA5202SeriesMotor', 19.2)
    expect(params.stallTorque).toBeCloseTo(24.3 * KGCM, 12)
    expect(params.freeSpeed).toBeCloseTo(312 * RPM, 12)
    expect(params.gearbox).toBeCloseTo((1 + 46 / 17) * (1 + 46 / 11), 12)
    // 유성 2단
    expect(params.efficiency).toBeCloseTo(0.95 ** 2, 12)
    expect(params).toMatchObject({
      stallCurrent: 9.2,
      freeCurrent: 0.25,
      rotorInertia: 3e-6,
      backdriveFriction: 2.3e-3
    })
    expect(resolveMotorParams('goBILDA5202SeriesMotor', 5.2).stallTorque).toBeCloseTo(
      7.9 * KGCM,
      12
    )
    expect(resolveMotorParams('goBILDA5202SeriesMotor', 188).efficiency).toBeCloseTo(0.95 ** 4)
    expect(resolveMotorParams('goBILDA5202SeriesMotor', 1).efficiency).toBe(1)
  })

  it('모델 기본(gearbox 0)은 그 형식의 실제 감속비다(Core Hex는 SDK 36.25가 아니라 72:1)', () => {
    const coreHex = resolveMotorParams('RevRoboticsCoreHexMotor', 'default')
    expect(coreHex).toMatchObject({
      stallTorque: 3.2,
      gearbox: 72,
      stallCurrent: 4.4,
      freeCurrent: 0.2,
      efficiency: 0.7,
      rotorInertia: 5e-7
    })
    expect(coreHex.freeSpeed).toBeCloseTo(125 * RPM, 12)
    expect(resolveMotorParams('goBILDA5202SeriesMotor', 'default').stallTorque).toBeCloseTo(
      133.2 * KGCM,
      12
    )
    expect(
      resolveMotorParams('RevRoboticsUltraplanetaryHDHexMotor', 'default').gearbox
    ).toBeCloseTo((76 / 21) * (68 / 13), 12)
  })

  it('UltraPlanetary는 카트리지 조합의 실제 감속비이고 이름(20:1)으로도 찾는다', () => {
    const twenty = resolveMotorParams('RevRoboticsUltraplanetaryHDHexMotor', 20)
    const actual = (76 / 21) * (68 / 13)
    expect(twenty.gearbox).toBeCloseTo(actual, 12)
    // REV 견본 표(효율 1의 이론값): 18.9:1 1.98 N·m·317 rpm. 출력 토크는 기어 효율을 곱한 값이다
    expect(twenty.stallTorque).toBeCloseTo(1.98 * 0.95 ** 2, 1)
    expect(twenty.freeSpeed / RPM).toBeCloseTo(317, 0)
    expect(twenty.efficiency).toBeCloseTo(0.95 ** 2, 12)
    const sixty = resolveMotorParams('RevRoboticsUltraplanetaryHDHexMotor', 60)
    expect(sixty.stallTorque).toBeCloseTo(5.75 * 0.95 ** 3, 1)
    expect(sixty.efficiency).toBeCloseTo(0.95 ** 3, 12)
    expect(resolveMotorParams('RevRoboticsUltraplanetaryHDHexMotor', 18.9).gearbox).toBeCloseTo(
      actual,
      12
    )
  })

  it('표에 없는 감속비는 가장 가까운 줄에서 감속비·효율 비율로 만든다', () => {
    const params = resolveMotorParams('goBILDA5202SeriesMotor', 30)
    const near = { ratio: (1 + 46 / 11) ** 2, torque: 38 * KGCM, rpm: 223 }
    expect(params.gearbox).toBe(30)
    // 30:1은 유성 3단, 26.9:1은 2단
    expect(params.efficiency).toBeCloseTo(0.95 ** 3, 12)
    expect(params.stallTorque).toBeCloseTo(near.torque * (30 / near.ratio) * 0.95, 12)
    expect(params.freeSpeed).toBeCloseTo(((near.rpm * near.ratio) / 30) * RPM, 12)
    // 평기어 계열은 효율이 감속비와 관계없다
    const neverest = resolveMotorParams('NeveRest40Gearmotor', 20)
    expect(neverest.stallTorque).toBeCloseTo((2.472 * 0.85) / 2, 12)
    expect(neverest.efficiency).toBe(0.85)
  })

  it('효율 1의 이론값을 공개하는 계열(REV·NeveRest)은 효율을 곱해, 되돌린 맨 모터 토크가 맨 모터 데이터시트와 같다', () => {
    // 시뮬레이터가 모터 상수를 τ_stall/(G·η)로 되돌린다(spec-3b 결정 1)
    const bare = (tag: string, gearbox: number | 'default'): number => {
      const p = resolveMotorParams(tag, gearbox)
      return p.stallTorque / (p.gearbox * p.efficiency)
    }
    // REV-41-1291 맨 모터 0.105 N·m
    for (const ratio of [3, 4, 5, 12, 20, 60, 100])
      expect(bare('RevRoboticsUltraplanetaryHDHexMotor', ratio)).toBeCloseTo(0.105, 12)
    expect(bare('RevRobotics20HDHexMotor', 'default')).toBeCloseTo(0.105, 12)
    expect(bare('RevRobotics40HDHexMotor', 'default')).toBeCloseTo(0.105, 12)
    // NeveRest 맨 모터 0.062 N·m(Classic 표는 반올림이라 1 % 안)
    expect(bare('NeveRest20Gearmotor', 'default')).toBeCloseTo(0.062, 12)
    expect(bare('NeveRest3.7v1Gearmotor', 'default')).toBeCloseTo(0.062, 12)
    expect(bare('NeveRest40Gearmotor', 'default') / 0.062).toBeCloseTo(1, 1)
    expect(bare('NeveRest60Gearmotor', 'default') / 0.062).toBeCloseTo(1, 1)
  })

  it('팀이 덮어쓴 정지 토크·무부하 속도(0 = 데이터시트)', () => {
    const params = resolveMotorParams('goBILDA5202SeriesMotor', 19.2, {
      stallTorque: 3,
      freeSpeedRpm: 300
    })
    expect(params.stallTorque).toBe(3)
    expect(params.freeSpeed).toBeCloseTo(300 * RPM, 12)
    const none = resolveMotorParams('goBILDA5202SeriesMotor', 19.2, {
      stallTorque: 0,
      freeSpeedRpm: Number.NaN
    })
    expect(none.freeSpeed).toBeCloseTo(312 * RPM, 12)
  })

  it('받는 범위 밖의 덮어쓰기는 데이터시트를 쓴다(세계 설명 하한 1e-6 N·m·1e-3 rad/s 아래로 가지 않음)', () => {
    const datasheet = resolveMotorParams('goBILDA5202SeriesMotor', 19.2)
    for (const stallTorque of [1e-7, 0.0004, -1, MAX_STALL_TORQUE_OVERRIDE * 2, Infinity]) {
      expect(
        resolveMotorParams('goBILDA5202SeriesMotor', 19.2, { stallTorque, freeSpeedRpm: 0 })
      ).toEqual(datasheet)
    }
    for (const freeSpeedRpm of [0.001, 0.5, -300, MAX_FREE_SPEED_OVERRIDE_RPM * 2]) {
      expect(
        resolveMotorParams('goBILDA5202SeriesMotor', 19.2, { stallTorque: 0, freeSpeedRpm })
      ).toEqual(datasheet)
    }
    // 경계 값은 덮어쓴다
    const low = resolveMotorParams('goBILDA5202SeriesMotor', 19.2, {
      stallTorque: MIN_STALL_TORQUE_OVERRIDE,
      freeSpeedRpm: MIN_FREE_SPEED_OVERRIDE_RPM
    })
    expect(low.stallTorque).toBe(MIN_STALL_TORQUE_OVERRIDE)
    expect(low.freeSpeed).toBeCloseTo(MIN_FREE_SPEED_OVERRIDE_RPM * RPM, 15)
    expect(low.stallTorque).toBeGreaterThanOrEqual(1e-6)
    expect(low.freeSpeed).toBeGreaterThanOrEqual(1e-3)
    const high = resolveMotorParams('goBILDA5202SeriesMotor', 19.2, {
      stallTorque: MAX_STALL_TORQUE_OVERRIDE,
      freeSpeedRpm: MAX_FREE_SPEED_OVERRIDE_RPM
    })
    expect(high.stallTorque).toBeLessThanOrEqual(1e3)
    expect(high.freeSpeed).toBeLessThanOrEqual(1e5)
  })

  it('관절 모터 엔코더: 출력축 1회전 틱 = 모터축 카운트 × 물리 감속비(제조사 출력축 카운트와 같다)', () => {
    const ticks = (tag: string, gearbox: number | 'default'): number =>
      jointEncoderTicksPerOutputRev(tag, resolveMotorParams(tag, gearbox).gearbox)
    // REV UltraPlanetary 4:1 + 5:1(실제 18.93:1): 모터축 28 카운트(REV motor-based-encoders "At the motor - 28 counts/
    // revolution") × 18.93 = 530.05(SDK 형식의 560이 아니다)
    expect(ticks('RevRoboticsUltraplanetaryHDHexMotor', 'default')).toBeCloseTo(
      28 * (76 / 21) * (68 / 13),
      9
    )
    // AndyMark NeveRest Orbital 20(19.2:1): 7 펄스 × 4 = 28 카운트 × 19.2 = 537.6
    expect(ticks('NeveRest20Gearmotor', 'default')).toBeCloseTo(537.6, 9)
    // REV Core Hex 72:1: 모터축 4 카운트, 출력축 288(REV core-hex-motor). SDK 형식(288 ÷ 36.25)이 아니다.
    expect(ticks('RevRoboticsCoreHexMotor', 'default')).toBeCloseTo(288, 9)
    expect(ticks('RevRoboticsCoreHexMotor', 72)).toBeCloseTo(288, 9)
    // goBILDA 5203 19.2:1: 28 × 19.2032 = 537.7(SDK 형식 2786 ÷ 99.5 × 19.2 = 537.6과 0.02 % 안)
    expect(ticks('goBILDA5202SeriesMotor', 19.2)).toBeCloseTo(28 * (1 + 46 / 17) * (1 + 46 / 11), 9)
    // REV HD Hex 20:1·40:1: 560·1120(REV 표)
    expect(ticks('RevRobotics20HDHexMotor', 'default')).toBeCloseTo(560, 9)
    expect(ticks('RevRobotics40HDHexMotor', 'default')).toBeCloseTo(1120, 9)
    // TETRIX TorqueNADO 60:1·40:1: 1440·960 cpr(Pitsco 데이터시트, 모터축 24)
    expect(ticks('TetrixMotor', 'default')).toBeCloseTo(1440, 9)
    expect(ticks('TetrixMotor', 40)).toBeCloseTo(960, 9)
    // Studica Maverick 61:1: 6 펄스 × 61 × 4 = 1464
    expect(ticks('StudicaMaverick', 'default')).toBeCloseTo(1464, 9)
    // goBILDA 5201 53:1(실제 53.475): 엔코더축 28, 출력축 1,497.325(goBILDA 5201-0002-0053 Specs "Encoder Countable Events
    // Per Revolution"). SDK 형식(1500 ÷ 54 = 27.78 × 53.475 = 1485.4)이 아니다.
    expect(ticks('goBILDA5201SeriesMotor', 'default')).toBeCloseTo(1497.3, 1)
    expect(ticks('goBILDA5201SeriesMotor', 'default')).toBeCloseTo(28 * 53.475, 9)
    // NeveRest Classic 40·60: 7 펄스 × 4 = 28 × 40·60 = 1120·1680
    expect(ticks('NeveRest40Gearmotor', 'default')).toBeCloseTo(1120, 9)
    expect(ticks('NeveRest60Gearmotor', 'default')).toBeCloseTo(1680, 9)
    // NeveRest Orbital 3.7: 같은 NeveRest 맨 모터·엔코더(7 펄스 × 4 = 28) × 3.7 = 103.6(SDK 형식 44.4 = 12 × 3.7이 아니다)
    expect(ticks('NeveRest3.7v1Gearmotor', 'default')).toBeCloseTo(103.6, 9)
    // MATRIX 12V: goBILDA와 같은 맨 모터·엔코더 28 × 52.8 = 1478.4(SDK 형식과 같다)
    expect(ticks('Matrix12vMotor', 'default')).toBeCloseTo(1478.4, 9)
    // 형식을 모르는 모터는 goBILDA 계열로 본다: 28 × SDK Motor gearing 52
    expect(ticks('Motor', 'default')).toBeCloseTo(28 * 52, 9)
    // 모든 계열의 모터축 카운트는 데이터시트 값(goBILDA·REV·NeveRest·MATRIX 28, Core Hex 4, TETRIX·Maverick 24)이다
    const counts: Record<string, number> = {
      goBILDA5201SeriesMotor: 28,
      goBILDA5202SeriesMotor: 28,
      Matrix12vMotor: 28,
      NeveRest20Gearmotor: 28,
      'NeveRest3.7v1Gearmotor': 28,
      NeveRest40Gearmotor: 28,
      NeveRest60Gearmotor: 28,
      RevRobotics20HDHexMotor: 28,
      RevRobotics40HDHexMotor: 28,
      RevRoboticsCoreHexMotor: 4,
      RevRoboticsUltraplanetaryHDHexMotor: 28,
      StudicaMaverick: 24,
      TetrixMotor: 24,
      Motor: 28
    }
    for (const tag of Object.keys(MOTOR_TYPES)) {
      expect(counts[tag]).toBeDefined()
      for (const gearbox of [1, 3.7, 20, 100])
        expect(jointEncoderTicksPerOutputRev(tag, gearbox)).toBeCloseTo(counts[tag] * gearbox, 9)
    }
  })

  it('모든 SDK 형식과 모르는 태그가 유한한 양수 값을 낸다(모르는 태그는 지정 안 함과 같다)', () => {
    for (const tag of Object.keys(MOTOR_TYPES)) {
      for (const gearbox of ['default', 1, 3.7, 20, 100] as const) {
        const params = resolveMotorParams(tag, gearbox)
        for (const value of Object.values(params)) {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThan(0)
        }
        expect(params.efficiency).toBeLessThanOrEqual(1)
      }
    }
    expect(resolveMotorParams('NoSuchMotor', 'default')).toEqual(
      resolveMotorParams('Motor', 'default')
    )
  })
})

describe('서보 물리 값', () => {
  it('goBILDA Torque(기본): 5 V 1.76 N·m·4.33 rad/s, 270°, 데드밴드 4 µs, 5°에서 포화', () => {
    const params = resolveServoParams(DEFAULT_SERVO_MODEL, 'servo')
    expect(params).toMatchObject({
      stallTorque: 1.76,
      freeSpeed: 4.33,
      deadbandUs: 4,
      crFullPower: 1
    })
    expect(params.rangeAngle).toBeCloseTo((270 * Math.PI) / 180, 12)
    expect(params.kp).toBeCloseTo(20.17, 2)
    expect(params.kd).toBeCloseTo(1.76 / 4.33, 12)
    expect(params.limpFriction).toBeCloseTo(0.088, 12)
    expect(resolveServoParams('nonsense', 'servo')).toEqual(params)
  })

  it('CR 서보는 각 범위를 쓰지 않고, 최고 속도에 닿는 |power|는 연속 회전 펄스 범위에서 나온다', () => {
    const full = (model: string): number => resolveServoParams(model, 'crServo').crFullPower
    expect(full('gobildaTorque')).toBeCloseTo(2 / 3, 12)
    expect(full('gobildaSpeed')).toBeCloseTo(5 / 9, 12)
    expect(full('axonMax')).toBeCloseTo(0.5, 12)
    expect(resolveServoParams('axonMini', 'crServo').rangeAngle).toBe(0)
  })

  it('REV SRS CR(500–2500 µs가 속도): power 1(2400 µs)에서 최고 속도의 90 %라 crFullPower 1에 토크·속도를 0.9배로 둔다', () => {
    const cr = resolveServoParams('revSmartServo', 'crServo')
    const position = resolveServoParams('revSmartServo', 'servo')
    expect(cr.crFullPower).toBe(1)
    expect(cr.stallTorque).toBeCloseTo(position.stallTorque * 0.9, 12)
    expect(cr.freeSpeed).toBeCloseTo(position.freeSpeed * 0.9, 12)
    // 토크-속도 직선의 기울기(와 kd)는 그대로, 기어 마찰은 실제 정지 토크로
    expect(cr.kd).toBeCloseTo(position.kd, 12)
    expect(cr.limpFriction).toBe(position.limpFriction)
    // CR 모델 τ = τs·(u − ω/ωf)가 SDK 범위의 모든 power에서 원래 표현(crFullPower 10/9)과 같다
    for (const power of [0.1, 0.5, 0.9, 1])
      for (const omega of [0, 1, 3])
        expect(
          cr.stallTorque * (Math.min(1, power / cr.crFullPower) - omega / cr.freeSpeed)
        ).toBeCloseTo(position.stallTorque * (power * 0.9 - omega / position.freeSpeed), 12)
  })

  it('모든 모델의 crFullPower는 세계 설명 범위(0.01–1) 안이다', () => {
    for (const model of SERVO_MODEL_KEYS)
      for (const kind of ['servo', 'crServo'] as const) {
        const { crFullPower } = resolveServoParams(model, kind)
        expect(crFullPower).toBeGreaterThanOrEqual(0.01)
        expect(crFullPower).toBeLessThanOrEqual(1)
      }
  })

  it('모든 모델이 유한한 양수 값을 낸다', () => {
    for (const model of SERVO_MODEL_KEYS)
      for (const kind of ['servo', 'crServo'] as const)
        for (const [key, value] of Object.entries(resolveServoParams(model, kind))) {
          expect(Number.isFinite(value)).toBe(true)
          if (!(kind === 'crServo' && key === 'rangeAngle')) expect(value).toBeGreaterThan(0)
        }
  })
})
