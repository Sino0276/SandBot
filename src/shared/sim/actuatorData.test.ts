import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERVO_MODEL,
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
    // REV 견본 표: 18.9:1 1.98 N·m·317 rpm
    expect(twenty.stallTorque).toBeCloseTo(1.98, 1)
    expect(twenty.freeSpeed / RPM).toBeCloseTo(317, 0)
    expect(twenty.efficiency).toBeCloseTo(0.95 ** 2, 12)
    const sixty = resolveMotorParams('RevRoboticsUltraplanetaryHDHexMotor', 60)
    expect(sixty.stallTorque).toBeCloseTo(5.75, 1)
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
    expect(neverest.stallTorque).toBeCloseTo(2.472 / 2, 12)
    expect(neverest.efficiency).toBe(0.85)
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
    // REV SRS는 500–2500 µs를 속도에 대응: SDK 범위 끝(2400 µs)에서도 최고 속도의 90 %
    expect(full('revSmartServo')).toBeCloseTo(10 / 9, 12)
    expect(resolveServoParams('axonMini', 'crServo').rangeAngle).toBe(0)
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
