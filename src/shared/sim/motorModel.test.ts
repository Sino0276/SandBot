import { describe, expect, it } from 'vitest'
import type { DeviceValues } from '../sidecarProtocol'
import {
  KP_POSITION,
  MotorModel,
  readMotorOutputs,
  TAU_BRAKE,
  TAU_DRIVE,
  TAU_FLOAT
} from './motorModel'

const GOBILDA = 'goBILDA5202SeriesMotor'
const H = 0.001

function outputs(values: DeviceValues): DeviceValues {
  return {
    mode: 'RUN_WITHOUT_ENCODER',
    power: 0,
    velocity: null,
    enabled: true,
    zeroPower: 'BRAKE',
    targetPosition: null,
    targetTolerance: 5,
    encoderOffset: 0,
    ...values
  }
}

// seconds 동안 1 ms 하위 단계로 돌리고 단계마다 틱을 모은다
function run(
  motor: MotorModel,
  values: DeviceValues,
  seconds: number,
  voltage = 12
): { raw: number[]; omega: number[] } {
  const out = readMotorOutputs(outputs(values))
  const raw: number[] = []
  const omega: number[] = []
  const steps = Math.round(seconds / H)
  for (let i = 0; i < steps; i++) {
    // 틱(5 ms)마다 명령을 다시 정한다(world.ts와 같다)
    const command = motor.command(out, voltage, out.encoderOffset)
    motor.advance(command, H)
    raw.push(motor.raw)
    omega.push(motor.omega)
  }
  return { raw, omega }
}

describe('모터 모델', () => {
  it('Kp·τ ≤ 0.25(넘침 없음)', () => {
    expect(KP_POSITION * TAU_DRIVE).toBeLessThanOrEqual(0.25)
    expect(TAU_BRAKE).toBeLessThan(TAU_DRIVE)
    expect(TAU_FLOAT).toBeGreaterThan(TAU_DRIVE)
  })

  it('1차 응답: τ에서 목표 속도의 63.2%, 하위 단계 크기와 관계없이 정확', () => {
    const motor = new MotorModel(GOBILDA, 19.2)
    const out = readMotorOutputs(outputs({ power: 1 }))
    const command = motor.command(out, 12, 0)
    expect(command.target).toBeCloseTo(motor.noLoad, 12)
    for (let i = 0; i < 100; i++) motor.advance(command, TAU_DRIVE / 100)
    expect(motor.omega / motor.noLoad).toBeCloseTo(1 - Math.exp(-1), 12)
    const once = new MotorModel(GOBILDA, 19.2)
    once.advance(command, TAU_DRIVE)
    expect(once.omega).toBeCloseTo(motor.omega, 12)
    // 각도도 정확한 적분: ω*·(t − τ(1 − e^(−t/τ)))
    const expected = motor.noLoad * (TAU_DRIVE - TAU_DRIVE * (1 - Math.exp(-1)))
    expect(once.raw / once.ticksPerRad).toBeCloseTo(expected, 12)
    expect(motor.raw).toBeCloseTo(once.raw, 9)
  })

  it('무부하 속도는 전압에 비례하고 power에 비례한다(엔코더 없음)', () => {
    const a = new MotorModel(GOBILDA, 19.2)
    const b = new MotorModel(GOBILDA, 19.2)
    run(a, { power: 0.5 }, 2, 12)
    run(b, { power: 0.5 }, 2, 9)
    expect(a.omega).toBeCloseTo(0.5 * a.noLoad, 6)
    expect(b.omega / a.omega).toBeCloseTo(9 / 12, 6)
  })

  it('RUN_USING_ENCODER: 목표 틱/s, 무부하 × 전압/12에서 잘림, 0이면 능동 유지', () => {
    const motor = new MotorModel(GOBILDA, 19.2)
    run(motor, { mode: 'RUN_USING_ENCODER', velocity: 1000, power: 1000 / 2368 }, 2)
    expect(motor.ticksPerSecond).toBeCloseTo(1000, 3)
    run(motor, { mode: 'RUN_USING_ENCODER', velocity: 30000, power: 1 }, 2, 12.5)
    expect(motor.omega).toBeCloseTo(motor.noLoad * (12.5 / 12), 6)
    const hold = motor.command(
      readMotorOutputs(outputs({ mode: 'RUN_USING_ENCODER', velocity: 0 })),
      12,
      0
    )
    expect(hold).toEqual({ target: 0, tau: TAU_BRAKE, position: null })
  })

  it('power 0: BRAKE는 짧게, FLOAT·꺼짐은 길게 멈춘다. 다 멈추면 정확히 0', () => {
    const brake = new MotorModel(GOBILDA, 19.2)
    const float = new MotorModel(GOBILDA, 19.2)
    const off = new MotorModel(GOBILDA, 19.2)
    for (const m of [brake, float, off]) run(m, { power: 1 }, 1)
    run(brake, { power: 0, zeroPower: 'BRAKE' }, TAU_BRAKE)
    run(float, { power: 0, zeroPower: 'FLOAT' }, TAU_BRAKE)
    run(off, { power: 1, enabled: false }, TAU_BRAKE)
    expect(brake.omega / brake.noLoad).toBeCloseTo(Math.exp(-1), 2)
    expect(float.omega / float.noLoad).toBeCloseTo(Math.exp(-TAU_BRAKE / TAU_FLOAT), 2)
    expect(off.omega).toBeCloseTo(float.omega, 9)
    run(brake, { power: 0 }, 5)
    expect(brake.omega).toBe(0)
    const before = brake.raw
    run(brake, { power: 0 }, 1)
    expect(brake.raw).toBe(before)
  })

  it('STOP_AND_RESET_ENCODER는 멈추고 power를 쓰지 않는다', () => {
    const motor = new MotorModel(GOBILDA, 19.2)
    run(motor, { power: 1 }, 1)
    const command = motor.command(
      readMotorOutputs(outputs({ mode: 'STOP_AND_RESET_ENCODER', power: 0.7 })),
      12,
      0
    )
    expect(command.target).toBe(0)
    expect(command.tau).toBe(TAU_BRAKE)
  })

  for (const [target, speed] of [
    [1000, 0.5],
    [-1500, 1],
    [40, 0.3],
    [3000, 0.1]
  ] as const)
    it(`RUN_TO_POSITION: ${target} 틱(속도 ${speed})까지 넘침 없이 가고 허용 오차 5 안에 든다`, () => {
      const motor = new MotorModel(GOBILDA, 19.2)
      const velocity = Math.round(speed * motor.hubMaxTicksPerSecond)
      const { raw } = run(
        motor,
        { mode: 'RUN_TO_POSITION', velocity, power: speed, targetPosition: target },
        Math.abs(target) / velocity + 4
      )
      const sign = Math.sign(target)
      expect(Math.max(...raw.map((r) => sign * r))).toBeLessThanOrEqual(Math.abs(target))
      const settled = raw.findIndex((r) => Math.abs(Math.floor(r) - target) <= 5)
      expect(settled).toBeGreaterThan(0)
      // 들어간 뒤로 다시 나가지 않는다
      expect(raw.slice(settled).every((r) => Math.abs(Math.floor(r) - target) <= 5)).toBe(true)
      expect(Math.abs(motor.raw - target)).toBeLessThan(0.01)
    })

  it('RUN_TO_POSITION: 원시 목표 = targetPosition + 리셋 오프셋, 속도 0이면 그 자리', () => {
    const motor = new MotorModel(GOBILDA, 19.2)
    run(motor, { power: 0.4 }, 0.5)
    const offset = Math.floor(motor.raw)
    run(
      motor,
      {
        mode: 'RUN_TO_POSITION',
        velocity: 1000,
        power: 0.42,
        targetPosition: 200,
        encoderOffset: offset
      },
      6
    )
    expect(motor.raw).toBeCloseTo(offset + 200, 2)
    const still = motor.command(
      readMotorOutputs(outputs({ mode: 'RUN_TO_POSITION', velocity: 0, targetPosition: 5000 })),
      12,
      0
    )
    expect(still.target).toBe(0)
    expect(still.position).toBeNull()
  })

  it('출력이 없거나 틀린 형식이면 꺼진 모터', () => {
    expect(readMotorOutputs(undefined)).toEqual({
      mode: 'RUN_WITHOUT_ENCODER',
      power: 0,
      velocity: null,
      enabled: false,
      zeroPower: 'BRAKE',
      targetPosition: null,
      encoderOffset: 0,
      encoderResets: 0
    })
    const weird = readMotorOutputs({
      mode: 'X',
      power: 'fast',
      enabled: 'yes',
      velocity: 'n',
      encoderResets: 'many'
    })
    expect(weird.enabled).toBe(false)
    expect(weird.power).toBe(0)
    expect(weird.velocity).toBeNull()
    expect(weird.encoderResets).toBe(0)
    expect(readMotorOutputs({ encoderResets: 3 }).encoderResets).toBe(3)
  })
})
