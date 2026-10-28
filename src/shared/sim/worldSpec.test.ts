import { describe, expect, it } from 'vitest'
import { parseWorldSpec, WORLD_SPEC_VERSION, type WorldSpec } from './worldSpec'

function valid(): WorldSpec {
  return {
    version: WORLD_SPEC_VERSION,
    robot: {
      start: { x: 0.5, y: -0.25, yaw: 1 },
      footprint: [
        { x: 0.2, y: 0.2 },
        { x: -0.2, y: 0.2 },
        { x: -0.2, y: -0.2 },
        { x: 0.2, y: -0.2 }
      ]
    },
    batteryVoltage: 12.5,
    hubs: ['Control Hub', 'Expansion Hub 2'],
    motors: [
      { device: 'fl', modelTag: 'goBILDA5202SeriesMotor', gearbox: 19.2, directionSign: -1 },
      { device: 'lift', modelTag: 'Motor', gearbox: 52, directionSign: 1 }
    ],
    wheels: [
      {
        position: { x: 0.15, y: 0.16 },
        angle: 0,
        kind: 'mecanum',
        rollers: 'flbr',
        radius: 0.052,
        gearRatio: 1,
        motor: 'fl'
      },
      {
        position: { x: -0.15, y: 0 },
        angle: Math.PI / 2,
        kind: 'omni',
        rollers: null,
        radius: 0.05,
        gearRatio: 2,
        motor: null
      }
    ],
    deadWheels: [
      {
        device: 'par',
        position: { x: 0, y: 0.1 },
        measures: 'forward',
        reversed: true,
        ticksPerMeter: 19894.4
      }
    ],
    pinpoints: [
      {
        device: 'pinpoint',
        xPod: { x: 0, y: 0.1 },
        yPod: null,
        podTicksPerMm: 19.89436789,
        xReversed: false,
        yReversed: true
      }
    ],
    otos: [{ device: 'otos', position: { x: 0.1, y: 0 }, mountingAngle: -Math.PI / 2 }],
    imus: [{ device: 'imu' }]
  }
}

describe('parseWorldSpec', () => {
  it('맞는 세계 설명은 같은 값의 새 객체(모르는 키는 버린다)', () => {
    const spec = valid()
    const parsed = parseWorldSpec({ ...spec, extra: 1, robot: { ...spec.robot, junk: true } })
    expect(parsed).toEqual(spec)
    expect(parsed).not.toBe(spec)
  })

  it.each([
    ['not an object', null],
    ['version', { ...valid(), version: 2 }],
    ['robot.footprint', { ...valid(), robot: { ...valid().robot, footprint: [{ x: 0, y: 0 }] } }],
    ['robot.start', { ...valid(), robot: { ...valid().robot, start: { x: 99, y: 0, yaw: 0 } } }],
    ['robot.start.yaw', { ...valid(), robot: { ...valid().robot, start: { x: 0, y: 0 } } }],
    ['batteryVoltage', { ...valid(), batteryVoltage: Number.NaN }],
    ['hubs[0]', { ...valid(), hubs: [''] }],
    ['motors[0].gearbox', { ...valid(), motors: [{ ...valid().motors[0], gearbox: 0 }] }],
    [
      'motors[0].directionSign',
      { ...valid(), motors: [{ ...valid().motors[0], directionSign: 0 }] }
    ],
    ['motors: duplicate device', { ...valid(), motors: [valid().motors[0], valid().motors[0]] }],
    ['wheels[0].rollers', { ...valid(), wheels: [{ ...valid().wheels[0], rollers: null }] }],
    [
      'wheels[1].rollers',
      { ...valid(), wheels: [valid().wheels[0], { ...valid().wheels[1], rollers: 'flbr' }] }
    ],
    ['wheels[0].radius', { ...valid(), wheels: [{ ...valid().wheels[0], radius: Infinity }] }],
    [
      'wheels[0].motor: unknown device',
      { ...valid(), wheels: [{ ...valid().wheels[0], motor: 'x' }] }
    ],
    [
      'deadWheels[0].measures',
      { ...valid(), deadWheels: [{ ...valid().deadWheels[0], measures: 'up' }] }
    ],
    [
      'pinpoints[0].reversed',
      { ...valid(), pinpoints: [{ ...valid().pinpoints[0], xReversed: 1 }] }
    ],
    ['otos[0].mountingAngle', { ...valid(), otos: [{ ...valid().otos[0], mountingAngle: 100 }] }],
    ['imus[0]', { ...valid(), imus: [{}] }],
    ['motors', { ...valid(), motors: new Array(65).fill(valid().motors[1]) }]
  ])('%s가 틀리면 그 이름을 돌려준다', (what, value) => {
    expect(parseWorldSpec(value)).toBe(what)
  })
})
