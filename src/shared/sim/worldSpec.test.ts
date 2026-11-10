import { describe, expect, it } from 'vitest'
import {
  TEST_ROBOT_HEIGHT,
  testChassis,
  testMotorParams,
  testWheelPhysics,
  worldV4Defaults
} from './testkit'
import {
  parseWorldSpec,
  WORLD_SPEC_VERSION,
  type SimCollider,
  type SimJointDriveSpec,
  type SimJointSpec,
  type WorldSpec
} from './worldSpec'

function valid(): WorldSpec {
  return {
    version: WORLD_SPEC_VERSION,
    // 'none' 시즌: 모양 검사만 본다
    ...worldV4Defaults(),
    robot: {
      start: { x: 0.5, y: -0.25, yaw: 1 },
      footprint: [
        { x: 0.2, y: 0.2 },
        { x: -0.2, y: 0.2 },
        { x: -0.2, y: -0.2 },
        { x: 0.2, y: -0.2 }
      ],
      height: TEST_ROBOT_HEIGHT,
      body: testChassis()
    },
    batteryVoltage: 12.5,
    hubs: ['Control Hub', 'Expansion Hub 2'],
    motors: [
      {
        device: 'fl',
        modelTag: 'goBILDA5202SeriesMotor',
        gearbox: 19.2,
        directionSign: -1,
        params: testMotorParams('goBILDA5202SeriesMotor', 19.2)
      },
      {
        device: 'lift',
        modelTag: 'Motor',
        gearbox: 52,
        directionSign: 1,
        params: testMotorParams('Motor', 'default')
      }
    ],
    wheels: [
      {
        position: { x: 0.15, y: 0.16 },
        angle: 0,
        kind: 'mecanum',
        rollers: 'flbr',
        radius: 0.052,
        gearRatio: 1,
        motor: 'fl',
        ...testWheelPhysics('mecanum', 0.052)
      },
      {
        position: { x: -0.15, y: 0 },
        angle: Math.PI / 2,
        kind: 'omni',
        rollers: null,
        radius: 0.05,
        gearRatio: 2,
        motor: null,
        ...testWheelPhysics('omni', 0.05)
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

// K8(spec-4ab §3·§5): 세계 설명 v4의 새 칸 검사
describe('parseWorldSpec v4', () => {
  const mount = { body: -1, position: { x: 0.1, y: 0, z: 0.05 }, rotation: { x: 0, y: 0, z: 0 } }
  const sensors = (): WorldSpec => ({
    ...withJoints(),
    distanceSensors: [{ device: 'front', mount }],
    colorSensors: [{ device: 'sample', mount: { ...mount, body: 2 } }]
  })
  const footprint = (points: [number, number][]): WorldSpec => ({
    ...valid(),
    robot: { ...valid().robot, footprint: points.map(([x, y]) => ({ x, y })) }
  })

  it('시즌·HIVE·높이·센서·잡음을 그대로 읽는다', () => {
    const spec: WorldSpec = {
      ...sensors(),
      field: { season: 'biobuzz', hiveTipped: [true, false] },
      noise: { enabled: true, seed: -42 }
    }
    const parsed = parseWorldSpec(spec)
    expect(parsed).toEqual(spec)
    expect(parsed).not.toBe(spec)
  })

  it("{ version }만 보내면 지금처럼 'robot'(새 검사는 robot 뒤)", () => {
    expect(parseWorldSpec({ version: WORLD_SPEC_VERSION })).toBe('robot')
    expect(WORLD_SPEC_VERSION).toBe(6)
    expect(parseWorldSpec({ ...valid(), version: 3 })).toBe('version')
  })

  it.each([
    ['field', { ...valid(), field: undefined }],
    ['field', { ...valid(), field: { season: 'decode2027', hiveTipped: [false, false] } }],
    ['field.hiveTipped', { ...valid(), field: { season: 'none', hiveTipped: [false] } }],
    ['field.hiveTipped', { ...valid(), field: { season: 'none', hiveTipped: [0, false] } }],
    ['robot.height', { ...valid(), robot: { ...valid().robot, height: 0 } }],
    ['robot.height', { ...valid(), robot: { ...valid().robot, height: 11 } }],
    ['robot.height', { ...valid(), robot: { ...valid().robot, height: undefined } }],
    ['noise', { ...valid(), noise: undefined }],
    ['noise', { ...valid(), noise: { enabled: 1, seed: 0 } }],
    ['noise', { ...valid(), noise: { enabled: false, seed: 0.5 } }],
    ['noise', { ...valid(), noise: { enabled: false, seed: 2 ** 53 } }],
    ['distanceSensors', { ...valid(), distanceSensors: undefined }],
    [
      'distanceSensors',
      { ...valid(), distanceSensors: new Array(33).fill({ device: 'd', mount }) }
    ],
    ['colorSensors', { ...valid(), colorSensors: {} }],
    [
      'distanceSensors[0].mount.body',
      { ...valid(), distanceSensors: [{ device: 'd', mount: { ...mount, body: 0 } }] }
    ],
    [
      'distanceSensors[0].mount.body',
      { ...valid(), distanceSensors: [{ device: 'd', mount: { ...mount, body: -2 } }] }
    ],
    [
      'colorSensors[0].mount.body',
      { ...sensors(), colorSensors: [{ device: 'c', mount: { ...mount, body: 3 } }] }
    ],
    [
      'colorSensors[0].mount.body',
      { ...sensors(), colorSensors: [{ device: 'c', mount: { ...mount, body: 0.5 } }] }
    ],
    [
      'distanceSensors[0].mount.position',
      {
        ...valid(),
        distanceSensors: [{ device: 'd', mount: { ...mount, position: { x: 11, y: 0, z: 0 } } }]
      }
    ],
    [
      'distanceSensors[0].mount.rotation',
      {
        ...valid(),
        distanceSensors: [{ device: 'd', mount: { ...mount, rotation: { x: 0, y: 0, z: 13 } } }]
      }
    ],
    ['distanceSensors[0].device', { ...valid(), distanceSensors: [{ device: '', mount }] }],
    ['distanceSensors[0]', { ...valid(), distanceSensors: [{ device: 'd' }] }]
  ])('%s가 틀리면 그 이름을 돌려준다', (what, value) => {
    expect(parseWorldSpec(value)).toBe(what)
  })

  it('목록마다 32개까지(따로 센다)', () => {
    const many = (prefix: string): { device: string; mount: typeof mount }[] =>
      Array.from({ length: 32 }, (_, i) => ({ device: `${prefix}${i}`, mount }))
    const spec = { ...valid(), distanceSensors: many('d'), colorSensors: many('c') }
    expect(typeof parseWorldSpec(spec)).toBe('object')
  })

  it.each([
    ['두 목록 사이', { colorSensors: [{ device: 'front', mount }] }, 'colorSensors[0]'],
    ['모터', { distanceSensors: [{ device: 'lift', mount }] }, 'distanceSensors[0]'],
    ['데드휠', { distanceSensors: [{ device: 'par', mount }] }, 'distanceSensors[0]'],
    ['Pinpoint', { distanceSensors: [{ device: 'pinpoint', mount }] }, 'distanceSensors[0]'],
    ['OTOS', { distanceSensors: [{ device: 'otos', mount }] }, 'distanceSensors[0]'],
    ['IMU', { distanceSensors: [{ device: 'imu', mount }] }, 'distanceSensors[0]'],
    ['관절 서보', { distanceSensors: [{ device: 'wrist', mount }] }, 'distanceSensors[0]'],
    ['리밋 스위치', { distanceSensors: [{ device: 'bottom', mount }] }, 'distanceSensors[0]'],
    [
      '같은 목록 안',
      {
        distanceSensors: [
          { device: 'x', mount },
          { device: 'x', mount }
        ]
      },
      'distanceSensors[1]'
    ]
  ])('센서 장치 이름이 %s와 겹치면 거부한다', (_, change, what) => {
    expect(parseWorldSpec({ ...sensors(), ...change })).toBe(`${what}.device: duplicate device`)
  })

  it.each([
    [
      '시계 방향 사각형',
      [
        [0.2, 0.2],
        [0.2, -0.2],
        [-0.2, -0.2],
        [-0.2, 0.2]
      ]
    ],
    [
      '오각별(두 바퀴 감김)',
      [0, 1, 2, 3, 4].map((k) => {
        const a = Math.PI / 2 + (k * 4 * Math.PI) / 5
        return [0.2 * Math.cos(a), 0.2 * Math.sin(a)]
      })
    ],
    [
      '일직선 세 점',
      [
        [0, 0],
        [0.1, 0],
        [0.2, 0]
      ]
    ],
    [
      '변 위의 점',
      [
        [0.2, -0.2],
        [0.2, 0],
        [0.2, 0.2],
        [-0.2, 0.2],
        [-0.2, -0.2]
      ]
    ],
    [
      '오목 다각형',
      [
        [0.2, -0.2],
        [0.2, 0.2],
        [0, 0],
        [-0.2, 0.2],
        [-0.2, -0.2]
      ]
    ]
  ] as [string, [number, number][]][])('외곽이 %s면 거부한다', (_, points) => {
    expect(parseWorldSpec(footprint(points))).toBe('robot.footprint')
  })

  it('반시계 볼록 외곽(삼각형·육각형)은 받는다', () => {
    expect(
      typeof parseWorldSpec(
        footprint([
          [0.2, 0.2],
          [-0.2, 0.2],
          [-0.2, -0.2]
        ])
      )
    ).toBe('object')
    const hexagon = [0, 1, 2, 3, 4, 5].map((k): [number, number] => [
      0.2 * Math.cos((k * Math.PI) / 3),
      0.2 * Math.sin((k * Math.PI) / 3)
    ])
    expect(typeof parseWorldSpec(footprint(hexagon))).toBe('object')
  })
})

// K7(spec-4d §3.1): 세계 설명 v5의 웹캠 목록
describe('parseWorldSpec v5', () => {
  const mount = { body: -1, position: { x: 0.2, y: 0, z: 0.3 }, rotation: { x: 0, y: -0.5, z: 0 } }
  const cam = (device: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    device,
    mount,
    model: 'logitechC920',
    ...extra
  })

  it('웹캠을 그대로 읽고 다른 키는 버린다', () => {
    const spec: WorldSpec = {
      ...withJoints(),
      cameras: [
        { device: 'Webcam 1', mount, model: 'logitechC920' },
        { device: 'turret', mount: { ...mount, body: 2 }, model: 'gobilda3122' }
      ]
    }
    const parsed = parseWorldSpec(spec)
    expect(parsed).toEqual(spec)
    const extra = parseWorldSpec({ ...withJoints(), cameras: [cam('Webcam 1', { fov: 70 })] })
    expect(typeof extra !== 'string' && extra.cameras[0]).toEqual({
      device: 'Webcam 1',
      mount,
      model: 'logitechC920'
    })
  })

  it('버전 5는 받지 않는다(렌더러와 메인은 같은 빌드)', () => {
    expect(WORLD_SPEC_VERSION).toBe(6)
    expect(parseWorldSpec({ ...valid(), version: 5 })).toBe('version')
  })

  it.each([
    ['cameras', { ...valid(), cameras: undefined }],
    ['cameras', { ...valid(), cameras: {} }],
    ['cameras', { ...valid(), cameras: Array.from({ length: 5 }, (_, i) => cam(`w${i}`)) }],
    ['cameras[0]', { ...valid(), cameras: [{ device: 'w', model: 'logitechC920' }] }],
    ['cameras[0].device', { ...valid(), cameras: [cam('')] }],
    [
      'cameras[0].mount.body',
      { ...valid(), cameras: [cam('w', { mount: { ...mount, body: 0 } })] }
    ],
    [
      'cameras[0].mount.body',
      { ...withJoints(), cameras: [cam('w', { mount: { ...mount, body: 3 } })] }
    ],
    [
      'cameras[0].mount.position',
      { ...valid(), cameras: [cam('w', { mount: { ...mount, position: { x: 11, y: 0, z: 0 } } })] }
    ],
    [
      'cameras[0].mount.rotation',
      { ...valid(), cameras: [cam('w', { mount: { ...mount, rotation: { x: 13, y: 0, z: 0 } } })] }
    ],
    ['cameras[0].model', { ...valid(), cameras: [cam('w', { model: 'logitechC930' })] }],
    ['cameras[0].model', { ...valid(), cameras: [cam('w', { model: undefined })] }]
  ])('%s가 틀리면 그 이름을 돌려준다', (what, value) => {
    expect(parseWorldSpec(value)).toBe(what)
  })

  it('4개까지', () => {
    const spec = { ...valid(), cameras: Array.from({ length: 4 }, (_, i) => cam(`w${i}`)) }
    expect(typeof parseWorldSpec(spec)).toBe('object')
  })

  it.each([
    ['거리 센서', { distanceSensors: [{ device: 'Webcam 1', mount }] }],
    ['컬러 센서', { colorSensors: [{ device: 'Webcam 1', mount }] }],
    ['모터', { cameras: [cam('lift')] }],
    ['데드휠', { cameras: [cam('par')] }],
    ['Pinpoint', { cameras: [cam('pinpoint')] }],
    ['OTOS', { cameras: [cam('otos')] }],
    ['IMU', { cameras: [cam('imu')] }],
    ['관절 서보', { cameras: [cam('wrist')] }],
    ['리밋 스위치', { cameras: [cam('bottom')] }],
    ['같은 목록 안', { cameras: [cam('Webcam 1'), cam('Webcam 1')] }]
  ])('웹캠 장치 이름이 %s와 겹치면 거부한다', (_, change) => {
    const base = { ...withJoints(), cameras: [cam('Webcam 1')] }
    const index = 'cameras' in change && (change.cameras as unknown[]).length === 2 ? 1 : 0
    expect(parseWorldSpec({ ...base, ...change })).toBe(
      `cameras[${index}].device: duplicate device`
    )
  })
})

// 5: 3D 충돌 형상(spec-5 §2.2, K1·K2)
describe('parseWorldSpec v6', () => {
  const v = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z })
  const cube = (s: number): { x: number; y: number; z: number }[] =>
    Array.from({ length: 8 }, (_, k) => v(k & 1 ? s : -s, k & 2 ? s : -s, k & 4 ? s : -s))
  const convex = (points = cube(0.1), extra: Record<string, unknown> = {}): SimCollider => ({
    kind: 'convex',
    points,
    friction: 0.4,
    ...extra
  })
  const box = (extra: Record<string, unknown> = {}): SimCollider =>
    ({
      kind: 'box',
      center: v(0, 0, 0.1),
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      half: v(0.2, 0.2, 0.1),
      friction: 0.5,
      ...extra
    }) as SimCollider
  const capsule = (extra: Record<string, unknown> = {}): SimCollider =>
    ({
      kind: 'capsule',
      a: v(0, 0, 0),
      b: v(0.25, 0, 0),
      radius: 0.02,
      friction: 1,
      ...extra
    }) as SimCollider
  const withRobot = (colliders: unknown[]): WorldSpec =>
    ({ ...withJoints(), robot: { ...withJoints().robot, colliders } }) as WorldSpec
  // 관절 넷(몸체 다섯: 몸체마다 16개까지라 합 65를 만들 수 있다)
  const fourJoints = (): WorldSpec => {
    const spec = withJoints()
    return {
      ...spec,
      joints: [...spec.joints, { ...spec.joints[2], parent: 2, drive: { kind: 'none' } }]
    }
  }

  it('형상이 없는 세계의 결과에는 충돌 키가 없다(v5와 키·값이 같다, K1)', () => {
    const parsed = parseWorldSpec(withJoints()) as WorldSpec
    expect(typeof parsed).toBe('object')
    expect('colliders' in parsed.robot).toBe(false)
    expect('collisionIgnore' in parsed).toBe(false)
    expect(parsed.joints.every((j) => !('colliders' in j))).toBe(true)
  })

  it('충돌체 셋 종류·구·관절 충돌체·무시 짝을 그대로 읽는다(다른 키는 버린다)', () => {
    const sphere = capsule({ b: v(0, 0, 0) })
    const spec: WorldSpec = {
      ...withJoints(),
      robot: { ...withJoints().robot, colliders: [convex(), box(), capsule(), sphere] },
      collisionIgnore: [[-1, 2]]
    }
    spec.joints[0].colliders = [box()]
    spec.joints[2].colliders = []
    const parsed = parseWorldSpec(spec)
    expect(parsed).toEqual(spec)
    const extra = parseWorldSpec(withRobot([{ ...box(), junk: 1 }])) as WorldSpec
    expect(extra.robot.colliders).toEqual([box()])
    const empty = parseWorldSpec(withRobot([])) as WorldSpec
    expect(empty.robot.colliders).toEqual([])
  })

  const plate = (thickness: number): { x: number; y: number; z: number }[] =>
    Array.from({ length: 8 }, (_, k) =>
      v(k & 1 ? 0.05 : -0.05, k & 2 ? 0.05 : -0.05, k & 4 ? thickness : 0)
    )
  const tilted = [0.6, -0.8, 0, 0.8, 0.6, 0, 0, 0, 1]

  it.each([
    ['robot.colliders[0].points', withRobot([convex(cube(0.1).slice(0, 3))])],
    [
      'robot.colliders[0].points',
      withRobot([
        convex(
          Array.from({ length: 65 }, (_, i) => v(i * 0.01, ((i * i) % 7) * 0.01, (i % 3) * 0.01))
        )
      ])
    ],
    ['robot.colliders[0].points: degenerate', withRobot([convex(plate(0))])],
    ['robot.colliders[0].points: degenerate', withRobot([convex(plate(0.0005))])],
    ['robot.colliders[0].points[0]', withRobot([convex([v(7, 0, 0), ...cube(0.1).slice(1)])])],
    ['robot.colliders[0].rotation', withRobot([box({ rotation: [1, 0, 0, 0, 1, 0.1, 0, 0, 1] })])],
    ['robot.colliders[0].rotation', withRobot([box({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, -1] })])],
    ['robot.colliders[0].rotation', withRobot([box({ rotation: tilted.slice(0, 8) })])],
    ['robot.colliders[0].half', withRobot([box({ half: v(0.2, 1e-4, 0.1) })])],
    ['robot.colliders[0].radius', withRobot([capsule({ radius: 0 })])],
    ['robot.colliders[0].radius', withRobot([capsule({ radius: 2 })])],
    ['robot.colliders[0].friction', withRobot([capsule({ friction: -0.1 })])],
    ['robot.colliders[0].friction', withRobot([box({ friction: 2.1 })])],
    [
      'robot.colliders[0].kind',
      withRobot([{ kind: 'sphere', center: v(0, 0, 0), radius: 0.1, friction: 0.4 }])
    ],
    ['robot.colliders', withRobot(new Array(17).fill(box()))],
    ['robot.colliders', { ...withJoints(), robot: { ...withJoints().robot, colliders: {} } }],
    ['collisionIgnore[0]', { ...withJoints(), collisionIgnore: [[2, 1]] }],
    ['collisionIgnore[0]', { ...withJoints(), collisionIgnore: [[-2, 0]] }],
    ['collisionIgnore[0]', { ...withJoints(), collisionIgnore: [[0, 3]] }],
    ['collisionIgnore[0]', { ...withJoints(), collisionIgnore: [[0, 1.5]] }],
    [
      'collisionIgnore: duplicate',
      {
        ...withJoints(),
        collisionIgnore: [
          [0, 1],
          [0, 1]
        ]
      }
    ]
  ])('%s가 틀리면 그 이름을 돌려준다', (what, value) => {
    expect(parseWorldSpec(value)).toBe(what)
  })

  it('회전한 상자(정규 직교·det > 0)는 받는다', () => {
    expect(typeof parseWorldSpec(withRobot([box({ rotation: tilted })]))).toBe('object')
  })

  it('관절 충돌체 칸은 그 관절 이름으로 거른다', () => {
    const spec = withJoints()
    spec.joints[1].colliders = [capsule({ radius: 0 })]
    expect(parseWorldSpec(spec)).toBe('joints[1].colliders[0].radius')
  })

  it('충돌체 합은 MAX_WORLD_COLLIDERS(64)까지', () => {
    const spec = fourJoints()
    spec.robot.colliders = new Array(16).fill(box())
    spec.joints.forEach((j, i) => (j.colliders = new Array(i === 3 ? 0 : 16).fill(box())))
    expect(typeof parseWorldSpec(spec)).toBe('object')
    spec.joints[3].colliders = [box()]
    expect(parseWorldSpec(spec)).toBe('colliders: too many')
  })

  it('지금 칸의 오류가 새 칸의 오류보다 먼저 나온다', () => {
    const bad = withRobot([capsule({ radius: 0 })])
    expect(parseWorldSpec({ ...bad, cameras: undefined })).toBe('cameras')
    expect(parseWorldSpec({ ...bad, robot: { ...bad.robot, height: 0 } })).toBe('robot.height')
    expect(parseWorldSpec({ ...bad, noise: null })).toBe('noise')
    // 이름·참조 검사는 새 칸 뒤다
    expect(
      parseWorldSpec({ ...bad, motors: [withJoints().motors[0], withJoints().motors[0]] })
    ).toBe('robot.colliders[0].radius')
  })
})
