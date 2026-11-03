import { describe, expect, it } from 'vitest'
import { readMotorOutputs } from './motorOutputs'

describe('모터 출력 해석', () => {
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
