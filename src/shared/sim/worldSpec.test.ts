import { describe, expect, it } from 'vitest'
import {
  parseWorldSpec,
  WORLD_SPEC_VERSION,
  type SimJointDriveSpec,
  type SimJointSpec,
  type WorldSpec
} from './worldSpec'

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
    imus: [{ device: 'imu' }],
    joints: []
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
    ['version', { ...valid(), version: 1 }],
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

// 관절 셋: 2단 cascade 리프트(모터 'lift'와 위 단) 위의 서보 팔, 리밋 스위치
function withJoints(): WorldSpec {
  const zero = { x: 0, y: 0, z: 0 }
  const base: SimJointSpec = {
    parent: -1,
    type: 'prismatic',
    origin: { position: { x: 0.1, y: 0, z: 0.05 }, rotation: zero },
    axis: { x: 0, y: 0, z: 1 },
    limits: { lower: 0, upper: 0.244 },
    body: { mass: 0.3, centerOfMass: zero, inertia: [0.001, 0.001, 0.0005, 0, 0, 0] },
    friction: { coulomb: 1, viscous: 0.5 },
    spring: { kind: 'constantForce', force: 5 },
    drive: {
      kind: 'motor',
      devices: ['lift'],
      ratio: 0.0178,
      params: {
        stallTorque: 2.383,
        freeSpeed: 32.67,
        stallCurrent: 9.2,
        freeCurrent: 0.25,
        gearbox: 19.2032,
        efficiency: 0.9025,
        rotorInertia: 3e-6,
        backdriveFriction: 0.0023
      },
      rigging: { kind: 'cascade', stages: [1] }
    },
    switches: [{ device: 'bottom', kind: 'touch', at: 'lower', within: 0.002 }]
  }
  return {
    ...valid(),
    joints: [
      base,
      { ...base, parent: 0, drive: { kind: 'stage' }, spring: null, switches: [] },
      {
        ...base,
        parent: 1,
        type: 'revolute',
        axis: { x: 0, y: 1, z: 0 },
        limits: null,
        spring: { kind: 'linear', stiffness: 0.2, rest: 0.1 },
        drive: {
          kind: 'servo',
          device: 'wrist',
          ratio: -1,
          params: {
            stallTorque: 1.76,
            freeSpeed: 4.33,
            rangeAngle: 4.71,
            deadbandUs: 4,
            kp: 20,
            kd: 0.05,
            crFullPower: 1,
            limpFriction: 0.05
          },
          zeroPulseUs: 1230,
          direction: -1
        },
        switches: []
      }
    ]
  }
}

describe('parseWorldSpec 관절', () => {
  it('맞는 관절 설명은 같은 값의 새 객체다', () => {
    const spec = withJoints()
    expect(parseWorldSpec(spec)).toEqual(spec)
  })

  const joint = (i: number, change: Partial<SimJointSpec>): WorldSpec => {
    const spec = withJoints()
    spec.joints[i] = { ...spec.joints[i], ...change }
    return spec
  }
  const liftDrive = withJoints().joints[0].drive as Extract<SimJointDriveSpec, { kind: 'motor' }>
  const body = withJoints().joints[0].body
  const wristDrive = withJoints().joints[2].drive as Extract<SimJointDriveSpec, { kind: 'servo' }>

  it.each([
    ['joints[1].parent', joint(1, { parent: 1 })],
    ['joints[0].parent', joint(0, { parent: -2 })],
    ['joints[0].limits', joint(0, { limits: null })],
    ['joints[0].limits', joint(0, { limits: { lower: 0.1, upper: 0.2 } })],
    ['joints[0].axis', joint(0, { axis: { x: 0, y: 0, z: 2 } })],
    ['joints[0].body', joint(0, { body: { ...body, mass: 0 } })],
    ['joints[0].body.inertia', joint(0, { body: { ...body, inertia: [1, 0.1, 0.1, 0, 0, 0] } })],
    ['joints[0].body.inertia', joint(0, { body: { ...body, inertia: [1, 1, 1, 2, 0, 0] } })],
    ['joints[0].friction', joint(0, { friction: { coulomb: -1, viscous: 0 } })],
    ['joints[0].spring', joint(0, { spring: { kind: 'linear', stiffness: -1, rest: 0 } })],
    [
      'joints[0].drive.devices[0]: unknown device',
      joint(0, { drive: { ...liftDrive, devices: ['nope'] } })
    ],
    [
      'joints[0].drive.devices[0]: wheel motor',
      joint(0, { drive: { ...liftDrive, devices: ['fl'] } })
    ],
    [
      'joints[0].drive.params.freeCurrent',
      joint(0, { drive: { ...liftDrive, params: { ...liftDrive.params, freeCurrent: 10 } } })
    ],
    ['joints[0].drive.ratio', joint(0, { drive: { ...liftDrive, ratio: 0 } })],
    [
      'joints[0].drive.rigging.stages[0]',
      joint(0, { drive: { ...liftDrive, rigging: { kind: 'cascade', stages: [2] } } })
    ],
    [
      'joints[1].drive: unused stage',
      joint(0, { drive: { ...liftDrive, rigging: { kind: 'direct' } } })
    ],
    [
      'joints[2].switches[0].at',
      joint(2, { switches: [{ device: 'top', kind: 'touch', at: 'upper', within: 0.01 }] })
    ],
    [
      'joints[1].switches[0].device: duplicate device',
      joint(1, { switches: [{ device: 'bottom', kind: 'digital', at: 'upper', within: 0.01 }] })
    ],
    ['joints[2].drive.zeroPulseUs', joint(2, { drive: { ...wristDrive, zeroPulseUs: 2600 } })],
    [
      'joints[2].drive.zeroPulseUs',
      joint(2, { drive: { ...wristDrive, zeroPulseUs: undefined as unknown as number } })
    ],
    [
      'joints[2].drive.direction',
      joint(2, { drive: { ...wristDrive, direction: 0 as unknown as 1 } })
    ],
    [
      'joints[2].drive.direction',
      joint(2, {
        drive: { kind: 'crServo', device: 'wrist', ratio: 1, params: wristDrive.params } as never
      })
    ],
    [
      'joints[2].drive.kind',
      joint(2, { drive: { kind: 'magic' } as unknown as SimJointDriveSpec })
    ],
    ['joints', { ...withJoints(), joints: new Array(17).fill(withJoints().joints[2]) }]
  ])('%s가 틀리면 그 이름을 돌려준다', (what, value) => {
    expect(parseWorldSpec(value)).toBe(what)
  })

  it('단위 축은 정규화한다', () => {
    const parsed = parseWorldSpec(joint(2, { axis: { x: 0, y: 1.0005, z: 0 } }))
    expect(typeof parsed !== 'string' && parsed.joints[2].axis).toEqual({ x: 0, y: 1, z: 0 })
  })
})
