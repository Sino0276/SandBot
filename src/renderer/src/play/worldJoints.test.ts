import { describe, expect, it } from 'vitest'
import { resolveMotorParams, resolveServoParams } from '../../../shared/sim/actuatorData'
import { MAX_WORLD_JOINTS, type SimInertia } from '../../../shared/sim/worldSpec'
import { propertyDefaults } from '../hardware/catalog'
import { createComponent } from '../hardware/components'
import { computeMassModel } from '../mass/massModel'
import type { MassLookup, MeshMassProps } from '../mass/types'
import { defaultJoint } from '../scene/joint'
import type {
  HardwareComponent,
  JointSettings,
  SceneObject,
  SceneObjects,
  Vec3
} from '../scene/model'
import { defaultWheel } from '../scene/wheel'
import {
  buildWorldJoints,
  FALLBACK_BODY_MASS,
  MAX_JOINT_SWITCHES,
  MIN_BODY_INERTIA,
  motorComponentParams
} from './worldJoints'
import { buildWorldSpec, type WorldWarning } from './worldSpec'

const SETTINGS = { batteryVoltage: 12 }

function component(
  type: string,
  id: string,
  name: string,
  props: Record<string, string | number> = {}
): HardwareComponent {
  const base = createComponent(type as Parameters<typeof createComponent>[0], [], () => id)
  return { ...base, name, props: { ...base.props, ...props } }
}

function group(
  id: string,
  parentId: string,
  position: Vec3 = [0, 0, 0],
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name: id,
    kind: 'group',
    parentId,
    transform: { position, rotation: [0, 0, 0] },
    ...extra
  }
}

const joint = (
  patch: Partial<JointSettings> = {},
  type: JointSettings['type'] = 'revolute'
): JointSettings => ({
  ...defaultJoint(type),
  ...patch
})

const NO_GEOMETRY: MassLookup = { props: () => undefined, sourcePath: () => undefined }

// 2단 연속 리깅 리프트 위의 손목. 무게는 형상 없는 그룹의 질량 덮어쓰기(점질량)로 둔다.
// R(로봇) ─ drive(모터 lift, 서보 wrist, 리밋 스위치 liftDown)
//         └ lift(직선 z, 모터, 연속 리깅 [stage2]) ─ liftMass 1 kg
//            └ stage2(직선 z, 위 단) ─ stageMass 0.3 kg
//               └ arm(회전 −y, 앵커 [0.02, 0, 0], 서보) ─ armMass 0.5 kg
function liftRobot(yaw = 0.7): SceneObjects {
  return {
    R: {
      id: 'R',
      name: 'Robot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0.4, -0.2, 0], rotation: [0, 0, yaw] }
    },
    drive: group('drive', 'R', [0, 0, 0.05], {
      components: [
        component('motor', 'm-lift', 'lift', { gearbox: 19.2 }),
        component('servo', 's-wrist', 'wrist', { servoModel: 'axonMax' }),
        component('touchSensor', 't-down', 'liftDown', { limitJoint: 'lift' })
      ]
    }),
    lift: group('lift', 'R', [0, 0, 0.1], {
      name: 'Lift',
      joint: joint(
        {
          axis: 'z',
          drive: {
            kind: 'motor',
            motors: ['m-lift'],
            gearRatio: 1,
            spoolDiameter: 0.0357,
            rigging: { kind: 'continuous', stages: ['stage2'] }
          }
        },
        'prismatic'
      )
    }),
    liftMass: group('liftMass', 'lift', [0, 0, 0.2], { mass: { mass: 1 } }),
    stage2: group('stage2', 'lift', [0, 0, 0.05], {
      name: 'Stage 2',
      joint: joint({ axis: 'z', drive: { kind: 'stage' } }, 'prismatic')
    }),
    stageMass: group('stageMass', 'stage2', [0, 0, 0.1], { mass: { mass: 0.3 } }),
    arm: {
      ...group('arm', 'stage2', [0.1, 0, 0.3], {
        name: 'Arm',
        joint: joint({
          axis: 'y',
          axisSign: -1,
          anchor: [0.02, 0, 0],
          drive: { kind: 'servo', servo: 's-wrist', gearRatio: 1 }
        })
      }),
      transform: { position: [0.1, 0, 0.3], rotation: [0, 0, Math.PI / 2] }
    },
    armMass: group('armMass', 'arm', [0.2, 0, 0], { mass: { mass: 0.5 } })
  }
}

// buildWorldSpec이 넘기는 것과 같은 입력(모터는 이 로봇의 모든 motor 컴포넌트)
function build(objects: SceneObjects, withMass = true): ReturnType<typeof buildWorldJoints> {
  const entries = Object.values(objects).flatMap((object) =>
    (object.components ?? []).map((c) => ({ objectId: object.id, component: c }))
  )
  const wheelObjects = Object.values(objects)
    .filter((object) => object.wheel)
    .map((object) => ({ objectId: object.id, name: object.name }))
  return buildWorldJoints({
    objects,
    robotId: 'R',
    entries,
    motorDevices: new Map(
      entries
        .filter((e) => e.component.type === 'motor')
        .map((e) => [e.component.id, e.component.name])
    ),
    wheelMotorIds: new Set(
      Object.values(objects).flatMap((object) => (object.wheel?.motor ? [object.wheel.motor] : []))
    ),
    wheelObjects,
    mass: withMass ? computeMassModel(objects, NO_GEOMETRY) : null
  })
}

const keys = (warnings: WorldWarning[]): string[] => warnings.map((w) => w.key)
const close = (v: { x: number; y: number; z: number }): Record<'x' | 'y' | 'z', unknown> => ({
  x: expect.closeTo(v.x, 12),
  y: expect.closeTo(v.y, 12),
  z: expect.closeTo(v.z, 12)
})
const FLOOR: SimInertia = [MIN_BODY_INERTIA, MIN_BODY_INERTIA, MIN_BODY_INERTIA, 0, 0, 0]

describe('세계 설명의 관절', () => {
  it('부모가 먼저인 순서, 부모 몸체 틀 기준 관절 틀, 축, 몸체(안쪽 관절 제외), 구동·리깅·스위치', () => {
    const { joints, objectIds, warnings } = build(liftRobot())
    expect(warnings).toEqual([])
    expect(objectIds).toEqual(['lift', 'stage2', 'arm'])
    expect(joints.map((j) => j.parent)).toEqual([-1, 0, 1])

    const [lift, stage2, arm] = joints
    expect(lift.origin).toEqual({
      position: close({ x: 0, y: 0, z: 0.1 }),
      rotation: close({ x: 0, y: 0, z: 0 })
    })
    expect(lift.axis).toEqual({ x: 0, y: 0, z: 1 })
    expect(lift.limits).toEqual({ lower: 0, upper: 0.5 })
    expect(lift.friction).toEqual({ coulomb: 1, viscous: 0.5 })
    // 리프트 몸체는 liftMass뿐이다(stage2 하위는 안쪽 관절의 몸체)
    expect(lift.body).toEqual({
      mass: 1,
      centerOfMass: close({ x: 0, y: 0, z: 0.2 }),
      // 점질량이라 관성 하한
      inertia: FLOOR
    })
    expect(lift.drive).toEqual({
      kind: 'motor',
      devices: ['lift'],
      ratio: 0.0357 / 2,
      params: resolveMotorParams('goBILDA5202SeriesMotor', 19.2),
      rigging: { kind: 'continuous', stages: [1] }
    })
    expect(lift.switches).toEqual([
      { device: 'liftDown', kind: 'touch', at: 'lower', within: 0.002 }
    ])

    expect(stage2.origin.position).toEqual(close({ x: 0, y: 0, z: 0.05 }))
    expect(stage2.drive).toEqual({ kind: 'stage' })
    expect(stage2.body.mass).toBe(0.3)

    // 손목: stage2 틀에서 [0.1, 0, 0.3]에 요 90°, 앵커 [0.02, 0, 0]은 손목 로컬이라 stage2 틀로 [0, 0.02, 0]
    expect(arm.origin).toEqual({
      position: close({ x: 0.1, y: 0.02, z: 0.3 }),
      rotation: close({ x: 0, y: 0, z: Math.PI / 2 })
    })
    expect(arm.axis).toEqual({ x: 0, y: -1, z: 0 })
    expect(Object.is(arm.axis.x, -0)).toBe(false)
    expect(arm.body.centerOfMass).toEqual(close({ x: 0.18, y: 0, z: 0 }))
    expect(arm.drive).toEqual({
      kind: 'servo',
      device: 'wrist',
      ratio: 1,
      params: resolveServoParams('axonMax', 'servo')
    })
  })

  it('로봇 자세와 관계없이 같다(관절 틀은 로봇 좌표·부모 몸체 틀 기준)', () => {
    // 수를 1e-12로 반올림해 비교한다(로봇 자세 행렬을 거친 반올림 오차)
    const rounded = (value: unknown): unknown =>
      JSON.parse(
        JSON.stringify(value, (_, x) => (typeof x === 'number' ? Math.round(x * 1e12) / 1e12 : x))
      )
    expect(rounded(build(liftRobot(-2.1)))).toEqual(rounded(build(liftRobot(0.7))))
  })

  it('몸체 관성은 관절 틀 축으로 돌린 무게중심 기준 관성이다', () => {
    // 1 × 2 × 3 cm 상자(알루미늄 6061)를 요 90° 관절 아래에: 관절 틀 축으로는 돌리기 전 상자의 관성 그대로
    const box: MeshMassProps = {
      volume: 0.01 * 0.02 * 0.03,
      centroid: [0, 0, 0],
      inertia: [
        (6e-6 * (0.02 ** 2 + 0.03 ** 2)) / 12,
        (6e-6 * (0.01 ** 2 + 0.03 ** 2)) / 12,
        (6e-6 * (0.01 ** 2 + 0.02 ** 2)) / 12,
        0,
        0,
        0
      ],
      area: 2 * (0.01 * 0.02 + 0.02 * 0.03 + 0.03 * 0.01),
      closure: 0
    }
    const objects: SceneObjects = {
      R: liftRobot().R,
      hinge: {
        ...group('hinge', 'R', [0.1, 0, 0.2], { joint: joint() }),
        transform: { position: [0.1, 0, 0.2], rotation: [0, 0, Math.PI / 2] }
      },
      block: {
        ...group('block', 'hinge', [0.05, 0, 0]),
        kind: 'part',
        visual: { type: 'mesh', geometryId: 'g:block', color: [1, 1, 1] }
      }
    }
    const lookup: MassLookup = {
      props: (id) => (id === 'g:block' ? box : undefined),
      sourcePath: () => undefined
    }
    const { joints } = buildWorldJoints({
      objects,
      robotId: 'R',
      entries: [],
      motorDevices: new Map(),
      wheelMotorIds: new Set(),
      wheelObjects: [],
      mass: computeMassModel(objects, lookup)
    })
    const density = 2700
    const body = joints[0].body
    expect(body.mass).toBeCloseTo(density * box.volume, 12)
    expect(body.centerOfMass).toEqual(close({ x: 0.05, y: 0, z: 0 }))
    body.inertia.forEach((value, i) => expect(value).toBeCloseTo(density * box.inertia[i], 15))
  })

  it('질량을 모르는 몸체는 1 g(경고), 질량 모델 없이 만들면 경고 없이 1 g', () => {
    const objects: SceneObjects = {
      R: liftRobot().R,
      hinge: group('hinge', 'R', [0, 0, 0.2], { name: 'Hinge', joint: joint() }),
      loading: {
        ...group('loading', 'hinge', [0.1, 0, 0]),
        kind: 'part',
        visual: { type: 'mesh', geometryId: 'g:loading', color: [1, 1, 1] }
      }
    }
    const withMass = build(objects)
    expect(withMass.joints[0].body).toEqual({
      mass: FALLBACK_BODY_MASS,
      centerOfMass: { x: 0, y: 0, z: 0 },
      inertia: FLOOR
    })
    expect(withMass.warnings).toEqual([
      { key: 'worldJointMassPending', params: { name: 'Hinge', count: 1 } },
      { key: 'worldJointNoMass', params: { name: 'Hinge' } }
    ])
    const without = build(objects, false)
    expect(without.joints[0].body).toEqual(withMass.joints[0].body)
    expect(without.warnings).toEqual([])
  })

  it('모터: 지운 모터·바퀴 모터·앞 관절이 쓴 모터는 빼고, 모터가 하나도 없으면 구동 없음', () => {
    const objects = liftRobot()
    objects.drive = {
      ...objects.drive,
      components: [
        ...objects.drive.components!,
        component('motor', 'm-wheel', 'driveLeft'),
        component('motor', 'm-other', 'liftRight', { gearbox: 13.7 })
      ]
    }
    objects.wheel = group('wheel', 'R', [0.2, 0.2, 0.05], {
      name: 'Wheel',
      wheel: { ...defaultWheel(), motor: 'm-wheel' }
    })
    const motorDrive = (motors: string[]): JointSettings['drive'] => ({
      kind: 'motor',
      motors,
      gearRatio: 2,
      spoolDiameter: 0.03,
      rigging: { kind: 'direct' }
    })
    objects.lift = {
      ...objects.lift,
      joint: { ...objects.lift.joint!, drive: motorDrive(['m-lift', 'gone', 'm-wheel', 'm-other']) }
    }
    objects.arm = {
      ...objects.arm,
      joint: { ...objects.arm.joint!, drive: motorDrive(['m-lift']) }
    }
    const { joints, warnings } = build(objects)
    expect(joints[0].drive).toMatchObject({
      kind: 'motor',
      devices: ['lift', 'liftRight'],
      // 첫 모터의 값
      params: resolveMotorParams('goBILDA5202SeriesMotor', 19.2),
      ratio: 0.015 / 2,
      rigging: { kind: 'direct' }
    })
    // 회전 관절: 출력축 rad당 관절 rad = 1 / 외부 감속비
    expect(joints[2].drive).toEqual({ kind: 'none' })
    expect(warnings).toEqual([
      { key: 'worldJointMotorMissing', params: { name: 'Lift' } },
      { key: 'worldJointMotorOnWheel', params: { name: 'Lift', motor: 'driveLeft' } },
      { key: 'worldJointMotorsDiffer', params: { name: 'Lift' } },
      { key: 'worldJointMotorShared', params: { name: 'Arm', motor: 'lift' } },
      // rigging이 없어진 위 단
      { key: 'worldJointStageOrphan', params: { name: 'Stage 2' } }
    ])
    expect(joints[1].drive).toEqual({ kind: 'none' })

    const empty = liftRobot()
    empty.arm = { ...empty.arm, joint: { ...empty.arm.joint!, drive: motorDrive([]) } }
    const result = build(empty)
    expect(result.joints[2].drive).toEqual({ kind: 'none' })
    expect(keys(result.warnings)).toEqual(['worldJointNoMotor'])
  })

  it('회전 관절 모터의 감속비, CR 서보 스풀', () => {
    const objects = liftRobot()
    objects.drive = {
      ...objects.drive,
      components: [
        ...objects.drive.components!,
        component('motor', 'm-arm', 'armMotor', { motorModel: 'revCoreHex' }),
        component('crServo', 'c-intake', 'intake', { servoModel: 'gobildaSpeed' })
      ]
    }
    objects.arm = {
      ...objects.arm,
      joint: {
        ...objects.arm.joint!,
        drive: {
          kind: 'motor',
          motors: ['m-arm'],
          gearRatio: 4,
          spoolDiameter: 0.03,
          rigging: { kind: 'direct' }
        }
      }
    }
    objects.lift = {
      ...objects.lift,
      joint: {
        ...objects.lift.joint!,
        drive: { kind: 'crServo', servo: 'c-intake', gearRatio: 2, spoolDiameter: 0.04 }
      }
    }
    const { joints, warnings } = build(objects)
    expect(joints[2].drive).toMatchObject({
      kind: 'motor',
      ratio: 0.25,
      // Core Hex 모델 기본은 실제 72:1
      params: expect.objectContaining({ gearbox: 72, stallTorque: 3.2 })
    })
    expect(joints[0].drive).toEqual({
      kind: 'crServo',
      device: 'intake',
      ratio: 0.01,
      params: resolveServoParams('gobildaSpeed', 'crServo')
    })
    expect(keys(warnings)).toEqual(['worldJointStageOrphan'])
  })

  it('모터 덮어쓰기가 받는 범위 밖(아주 작은 값, 손으로 고친 큰 값)이면 데이터시트(세계 설명을 깨지 않음)', () => {
    const datasheet = resolveMotorParams('goBILDA5202SeriesMotor', 19.2)
    const motor = (props: Record<string, number>): HardwareComponent['props'] => ({
      ...propertyDefaults('motor'),
      gearbox: 19.2,
      ...props
    })
    const outOfRange: Record<string, number>[] = [
      { stallTorque: 1e-7 },
      { stallTorque: 0.0004 },
      { freeSpeed: 0.001 },
      { stallTorque: 1e6, freeSpeed: 1e7 }
    ]
    for (const props of outOfRange) expect(motorComponentParams(motor(props))).toEqual(datasheet)
    const custom = motorComponentParams(motor({ stallTorque: 2, freeSpeed: 200 }))
    expect(custom.stallTorque).toBe(2)
    expect(custom.freeSpeed).toBeCloseTo((200 * 2 * Math.PI) / 60, 12)
  })

  it('SPARK Mini는 3b의 관절 구동이 아니다: 어떤 구동 종류로 가리켜도 구동 없음(세계 설명에 넣지 않는다)', () => {
    for (const drive of [
      { kind: 'crServo', servo: 'spark', gearRatio: 1, spoolDiameter: 0.03 },
      { kind: 'servo', servo: 'spark', gearRatio: 1 },
      {
        kind: 'motor',
        motors: ['spark'],
        gearRatio: 1,
        spoolDiameter: 0.03,
        rigging: { kind: 'direct' }
      }
    ] as JointSettings['drive'][]) {
      const objects = liftRobot()
      objects.drive = {
        ...objects.drive,
        components: [...objects.drive.components!, component('sparkMini', 'spark', 'sparky')]
      }
      objects.arm = { ...objects.arm, joint: { ...defaultJoint('revolute'), drive } }
      const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
      expect(spec!.joints[2].drive).toEqual({ kind: 'none' })
      expect(JSON.stringify(spec!.joints)).not.toContain('sparky')
      expect(spec!.motors.map((m) => m.device)).not.toContain('sparky')
      expect(warnings.map((w) => w.key)).toContain(
        drive.kind === 'motor' ? 'worldJointMotorMissing' : 'worldJointServoMissing'
      )
    }
  })

  it('서보: 없는 서보·다른 종류·직선 관절의 위치 서보는 구동 없음', () => {
    const cases: [JointSettings['drive'], 'revolute' | 'prismatic', string][] = [
      [{ kind: 'servo', servo: 'gone', gearRatio: 1 }, 'revolute', 'worldJointServoMissing'],
      [
        { kind: 'crServo', servo: 's-wrist', gearRatio: 1, spoolDiameter: 0.03 },
        'revolute',
        'worldJointServoMissing'
      ],
      [{ kind: 'servo', servo: 'm-lift', gearRatio: 1 }, 'revolute', 'worldJointServoMissing'],
      [{ kind: 'servo', servo: 's-wrist', gearRatio: 1 }, 'prismatic', 'worldJointServoOnSlide']
    ]
    for (const [drive, type, key] of cases) {
      const objects = liftRobot()
      objects.arm = { ...objects.arm, joint: { ...defaultJoint(type), drive } }
      const { joints, warnings } = build(objects)
      expect(joints[2].drive).toEqual({ kind: 'none' })
      expect(warnings).toEqual([{ key, params: { name: 'Arm' } }])
    }
  })

  it('서보 하나를 두 관절이 쓰면 앞 관절만 구동한다(세계 설명 전체를 잃지 않는다)', () => {
    const objects = liftRobot()
    objects.claw = group('claw', 'armMass', [0.1, 0, 0], {
      name: 'Claw',
      mass: { mass: 0.1 },
      joint: joint({ drive: { kind: 'servo', servo: 's-wrist', gearRatio: 2 } })
    })
    const { joints, warnings } = build(objects)
    expect(joints[2].drive).toMatchObject({ kind: 'servo', device: 'wrist' })
    expect(joints[3].drive).toEqual({ kind: 'none' })
    expect(warnings).toEqual([
      { key: 'worldJointServoShared', params: { name: 'Claw', servo: 'wrist' } }
    ])
  })

  it('전달 비가 세계 설명 범위(1e-6–1e3) 밖이면 구동하지 않고 모터를 차지하지 않는다', () => {
    const objects = liftRobot()
    const drive = objects.lift.joint!.drive as Extract<JointSettings['drive'], { kind: 'motor' }>
    // 1 mm 스풀 × 1000:1 → 0.0005 / 1000 = 5e-7 m/rad
    objects.lift = {
      ...objects.lift,
      joint: {
        ...objects.lift.joint!,
        drive: { ...drive, spoolDiameter: 0.001, gearRatio: 1000 }
      }
    }
    objects.arm = {
      ...objects.arm,
      joint: {
        ...defaultJoint(),
        drive: {
          kind: 'motor',
          motors: ['m-lift'],
          gearRatio: 1,
          spoolDiameter: 0.03,
          rigging: { kind: 'direct' }
        }
      }
    }
    const { joints, warnings } = build(objects)
    expect(joints[0].drive).toEqual({ kind: 'none' })
    expect(joints[2].drive).toMatchObject({ kind: 'motor', devices: ['lift'], ratio: 1 })
    expect(keys(warnings)).toEqual(['worldJointRatioRange', 'worldJointStageOrphan'])
  })

  it('문서에 정리되지 않은 값이 있어도 검증 한도 안으로 정리해 넣는다', () => {
    const objects = liftRobot()
    objects.arm = {
      ...objects.arm,
      joint: {
        ...objects.arm.joint!,
        limits: { lower: 0.2, upper: 1 },
        friction: { coulomb: 2e4, viscous: 0 }
      }
    }
    const { joints } = build(objects)
    expect(joints[2].limits).toEqual({ lower: 0, upper: 1 })
    expect(joints[2].friction).toEqual({ coulomb: 1e4, viscous: 0 })
  })

  it('다단 슬라이드: 위 단은 바로 아래 단의 자식인 직선 관절이어야 하고, 맞지 않는 단부터 묶지 않는다', () => {
    const objects = liftRobot()
    // arm을 직선 위 단으로 바꿔도 stage2를 건너뛰고 lift에 바로 묶을 수는 없다
    objects.arm = {
      ...objects.arm,
      joint: { ...defaultJoint('prismatic'), drive: { kind: 'stage' } }
    }
    const drive = objects.lift.joint!.drive as Extract<JointSettings['drive'], { kind: 'motor' }>
    objects.lift = {
      ...objects.lift,
      joint: {
        ...objects.lift.joint!,
        drive: { ...drive, rigging: { kind: 'cascade', stages: ['arm', 'stage2'] } }
      }
    }
    const { joints, warnings } = build(objects)
    expect(joints[0].drive).toMatchObject({ rigging: { kind: 'direct' } })
    expect(warnings).toEqual([
      { key: 'worldJointStageInvalid', params: { name: 'Lift', stage: 'Arm' } },
      { key: 'worldJointStageOrphan', params: { name: 'Stage 2' } },
      { key: 'worldJointStageOrphan', params: { name: 'Arm' } }
    ])

    // 순서대로면 두 단 모두 묶는다
    objects.lift = {
      ...objects.lift,
      joint: {
        ...objects.lift.joint!,
        drive: { ...drive, rigging: { kind: 'cascade', stages: ['stage2', 'arm'] } }
      }
    }
    const linked = build(objects)
    expect(linked.joints[0].drive).toMatchObject({ rigging: { kind: 'cascade', stages: [1, 2] } })
    expect(linked.warnings).toEqual([])
  })

  it('리밋 스위치: digital은 state, 없는 관절·한계 없는 관절은 경고', () => {
    const objects = liftRobot()
    objects.drive = {
      ...objects.drive,
      components: [
        ...objects.drive.components!,
        component('digitalDevice', 'd-up', 'liftUp', {
          limitJoint: 'stage2',
          limitAt: 'upper',
          limitDistance: 0.005
        }),
        component('digitalDevice', 'd-arm', 'armHome', { limitJoint: 'arm' }),
        component('touchSensor', 't-gone', 'oldSwitch', { limitJoint: 'deleted' })
      ]
    }
    objects.arm = { ...objects.arm, joint: { ...objects.arm.joint!, limits: null } }
    const { joints, warnings } = build(objects)
    expect(joints[1].switches).toEqual([
      { device: 'liftUp', kind: 'digital', at: 'upper', within: 0.005 }
    ])
    expect(joints[2].switches).toEqual([])
    expect(warnings).toEqual([
      { key: 'worldLimitSwitchNoLimit', params: { name: 'armHome', joint: 'Arm' } },
      { key: 'worldLimitSwitchJointMissing', params: { name: 'oldSwitch' } }
    ])
    // 회전 관절의 기본 거리는 1°
    const revolute = liftRobot()
    revolute.drive = {
      ...revolute.drive,
      components: [component('touchSensor', 't-arm', 'armDown', { limitJoint: 'arm' })]
    }
    expect(build(revolute).joints[2].switches[0].within).toBeCloseTo(Math.PI / 180, 15)
    // 회전 관절은 limitAngle(rad), 직선 관절은 limitDistance(m)만 읽는다
    revolute.drive = {
      ...revolute.drive,
      components: [
        component('touchSensor', 't-arm', 'armDown', {
          limitJoint: 'arm',
          limitDistance: 0.3,
          limitAngle: 0.05
        }),
        component('touchSensor', 't-lift', 'liftDown', {
          limitJoint: 'stage2',
          limitDistance: 0.004,
          limitAngle: 0.5
        })
      ]
    }
    const switched = build(revolute)
    expect(switched.joints[2].switches[0].within).toBe(0.05)
    expect(switched.joints[1].switches[0].within).toBe(0.004)
  })

  it(`리밋 스위치: 이름이 겹치는 장치는 한 번만, 관절마다 ${MAX_JOINT_SWITCHES}개까지`, () => {
    const objects = liftRobot()
    objects.drive = {
      ...objects.drive,
      components: [
        ...objects.drive.components!,
        // 같은 이름(생성이 막힌 구성)의 스위치·모터 이름과 같은 스위치
        component('touchSensor', 't-dup', 'liftDown', { limitJoint: 'lift' }),
        component('digitalDevice', 'd-motor', 'lift', { limitJoint: 'lift' }),
        ...Array.from({ length: MAX_JOINT_SWITCHES }, (_, k) =>
          component('touchSensor', `t-${k}`, `stop${k}`, { limitJoint: 'lift' })
        )
      ]
    }
    const { joints, warnings } = build(objects)
    expect(joints[0].switches.map((s) => s.device)).toEqual([
      'liftDown',
      ...Array.from({ length: MAX_JOINT_SWITCHES - 1 }, (_, k) => `stop${k}`)
    ])
    expect(warnings).toEqual([
      { key: 'worldLimitSwitchDuplicate', params: { name: 'liftDown' } },
      { key: 'worldLimitSwitchDuplicate', params: { name: 'lift' } },
      {
        key: 'worldLimitSwitchTooMany',
        params: { name: `stop${MAX_JOINT_SWITCHES - 1}`, joint: 'Lift', max: MAX_JOINT_SWITCHES }
      }
    ])
  })

  it('관절 하위의 센서·포드·바퀴는 경고한다(로봇 몸체에 붙은 것으로 계산)', () => {
    const objects = liftRobot()
    objects.armMass = {
      ...objects.armMass,
      components: [
        component('imu', 'imu', 'imu'),
        component('pinpoint', 'pp', 'pinpoint', { xPod: 'pod', yPod: '' })
      ]
    }
    objects.pod = group('pod', 'stage2', [0, 0.1, 0])
    objects.podOnBody = group('podOnBody', 'R', [0, -0.1, 0])
    objects.roller = group('roller', 'lift', [0.1, 0, 0], {
      name: 'Roller',
      wheel: { ...defaultWheel('omni'), motor: '' }
    })
    const { warnings } = build(objects)
    expect(warnings).toEqual([
      { key: 'worldSensorOnJoint', params: { name: 'imu', joint: 'Arm' } },
      { key: 'worldSensorOnJoint', params: { name: 'pinpoint', joint: 'Arm' } },
      { key: 'worldSensorOnJoint', params: { name: 'pinpoint', joint: 'Stage 2' } },
      { key: 'worldWheelOnJoint', params: { name: 'Roller', joint: 'Lift' } }
    ])
  })

  it(`관절은 ${MAX_WORLD_JOINTS}개까지, 넘는 관절의 하위는 가장 가까운 남은 관절의 몸체다`, () => {
    const objects: SceneObjects = { R: liftRobot().R }
    let parent = 'R'
    for (let i = 0; i < MAX_WORLD_JOINTS + 2; i++) {
      objects[`j${i}`] = group(`j${i}`, parent, [0, 0, 0.01], { joint: joint() })
      parent = `j${i}`
    }
    objects.tip = group('tip', parent, [0, 0, 0.01], { mass: { mass: 0.2 } })
    const { joints, objectIds, warnings } = build(objects)
    expect(joints).toHaveLength(MAX_WORLD_JOINTS)
    expect(objectIds.at(-1)).toBe(`j${MAX_WORLD_JOINTS - 1}`)
    expect(joints.at(-1)!.body.mass).toBe(0.2)
    // 끝의 몸체 무게중심은 마지막 남은 관절 틀에서 뺀 두 관절과 tip만큼 위
    expect(joints.at(-1)!.body.centerOfMass.z).toBeCloseTo(0.03, 12)
    expect(warnings[0]).toEqual({ key: 'worldTooManyJoints', params: { max: MAX_WORLD_JOINTS } })
  })

  it('로봇과 바퀴 오브젝트의 관절은 쓰지 않는다', () => {
    const objects = liftRobot()
    objects.R = { ...objects.R, joint: joint() }
    objects.wheel = group('wheel', 'R', [0, 0, 0], { wheel: defaultWheel(), joint: joint() })
    expect(build(objects).objectIds).toEqual(['lift', 'stage2', 'arm'])
  })
})

describe('buildWorldSpec의 관절', () => {
  it('세계 설명에 관절과 관절 순번 → 오브젝트 id를 넣고, 관절이 없으면 둘 다 비어 있다', () => {
    const objects = liftRobot()
    const mass = computeMassModel(objects, NO_GEOMETRY)
    const result = buildWorldSpec(objects, 'R', SETTINGS, mass)
    expect(result.spec!.joints).toEqual(build(objects).joints)
    expect(result.jointObjectIds).toEqual(['lift', 'stage2', 'arm'])
    // 질량 모델이 없는 곳(로봇 카드)에서는 몸체 질량 경고가 없다
    const plain = buildWorldSpec({ R: objects.R }, 'R', SETTINGS)
    expect(plain.spec!.joints).toEqual([])
    expect(plain.jointObjectIds).toEqual([])
  })

  it('바퀴를 구동하는 모터는 관절에 쓰지 않는다', () => {
    const objects = liftRobot()
    objects.wheel = group('wheel', 'R', [0.2, 0.2, 0.05], {
      name: 'Wheel',
      wheel: { ...defaultWheel(), motor: 'm-lift' }
    })
    const { spec, warnings } = buildWorldSpec(objects, 'R', SETTINGS)
    expect(spec!.wheels[0].motor).toBe('lift')
    expect(spec!.joints[0].drive).toEqual({ kind: 'none' })
    expect(keys(warnings)).toContain('worldJointMotorOnWheel')
  })
})
