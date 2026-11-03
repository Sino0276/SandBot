import { describe, expect, it } from 'vitest'
import {
  canHaveJoint,
  DEFAULT_SPOOL_DIAMETER,
  MAX_JOINT_DAMPING,
  MAX_JOINT_FORCE,
  MAX_JOINT_STIFFNESS,
  defaultJoint,
  defaultJointDrive,
  JOINT_DRIVE_KINDS,
  jointTypePatch,
  sameJoint,
  sanitizeJoint
} from './joint'
import type { JointSettings, SceneObject } from './model'
import { defaultWheel } from './wheel'

const object = (patch: Partial<SceneObject>): SceneObject => ({
  id: 'o',
  name: 'o',
  kind: 'group',
  parentId: 'r',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
  ...patch
})

describe('관절 설정', () => {
  it('기본값: 회전 ±90°·0.02 N·m, 직선 0–0.5 m·1 N, 축은 Unity처럼 X', () => {
    expect(defaultJoint()).toEqual({
      type: 'revolute',
      anchor: [0, 0, 0],
      axis: 'x',
      axisSign: 1,
      limits: { lower: -Math.PI / 2, upper: Math.PI / 2 },
      friction: { coulomb: 0.02, viscous: 0.001 },
      spring: null,
      drive: { kind: 'none' }
    })
    expect(defaultJoint('prismatic')).toMatchObject({
      limits: { lower: 0, upper: 0.5 },
      friction: { coulomb: 1, viscous: 0.5 }
    })
    // 기본값은 매번 새 객체다(스토어가 고쳐도 다른 관절에 번지지 않게)
    expect(defaultJoint().limits).not.toBe(defaultJoint().limits)
  })

  it('로봇과 바퀴가 있는 오브젝트에는 붙이지 않는다(CAD 루트는 된다)', () => {
    expect(canHaveJoint(object({}))).toBe(true)
    expect(canHaveJoint(object({ kind: 'part' }))).toBe(true)
    expect(
      canHaveJoint(
        object({
          kind: 'assembly',
          cad: {
            fileName: 'a.step',
            absolutePath: '/a.step',
            upAxis: '+Z',
            forwardAxis: '+X',
            bounds: { min: [0, 0, 0], max: [1, 1, 1] },
            meshCount: 0
          }
        })
      )
    ).toBe(true)
    expect(canHaveJoint(object({ kind: 'robot', parentId: null }))).toBe(false)
    expect(canHaveJoint(object({ wheel: defaultWheel() }))).toBe(false)
  })

  it('정리: 범위 밖은 기본값, 직선 관절은 한계가 늘 있고, 회전 관절은 null(제한 없음)을 받는다', () => {
    const revolute = sanitizeJoint({ ...defaultJoint(), limits: null })
    expect(revolute.limits).toBeNull()
    expect(sanitizeJoint({ ...defaultJoint('prismatic'), limits: null }).limits).toEqual({
      lower: 0,
      upper: 0.5
    })
    expect(sanitizeJoint({ ...defaultJoint(), limits: { lower: 1, upper: 0 } }).limits).toEqual(
      defaultJoint().limits
    )
    expect(sanitizeJoint({ ...defaultJoint(), limits: { lower: -13, upper: 0 } }).limits).toEqual(
      defaultJoint().limits
    )
    expect(
      sanitizeJoint({ ...defaultJoint('prismatic'), limits: { lower: -0.1, upper: 1.2 } }).limits
    ).toEqual({ lower: -0.1, upper: 1.2 })
    expect(sanitizeJoint({ ...defaultJoint(), anchor: [0, Number.NaN, 0] }).anchor).toEqual([
      0, 0, 0
    ])
    expect(sanitizeJoint({ ...defaultJoint(), anchor: [10, -10, 0.25] }).anchor).toEqual([
      10, -10, 0.25
    ])
    expect(
      sanitizeJoint({ ...defaultJoint(), friction: { coulomb: 0, viscous: -0.1 } }).friction
    ).toEqual({ coulomb: 0, viscous: 0.001 })
  })

  it('정리: 스프링은 힘·강성이 0 이상이고 쉬는 자리가 한도 안이어야 한다', () => {
    const spring = (value: JointSettings['spring']): JointSettings['spring'] =>
      sanitizeJoint({ ...defaultJoint('prismatic'), spring: value }).spring
    expect(spring({ kind: 'constantForce', force: 35.2 })).toEqual({
      kind: 'constantForce',
      force: 35.2
    })
    expect(spring({ kind: 'constantForce', force: -1 })).toBeNull()
    expect(spring({ kind: 'linear', stiffness: 50, rest: -0.1 })).toEqual({
      kind: 'linear',
      stiffness: 50,
      rest: -0.1
    })
    expect(spring({ kind: 'linear', stiffness: Infinity, rest: 0 })).toBeNull()
    expect(spring({ kind: 'linear', stiffness: 1, rest: 11 })).toBeNull()
  })

  it('정리: 한계는 편집 자세(q = 0)를 품도록 가까운 끝을 0으로 넓힌다', () => {
    const limits = (
      type: JointSettings['type'],
      value: JointSettings['limits']
    ): JointSettings['limits'] => sanitizeJoint({ ...defaultJoint(type), limits: value }).limits
    expect(limits('prismatic', { lower: 0.1, upper: 0.5 })).toEqual({ lower: 0, upper: 0.5 })
    expect(limits('revolute', { lower: -1, upper: -0.5 })).toEqual({ lower: -1, upper: 0 })
    expect(limits('revolute', { lower: 0.2, upper: 0.2 })).toEqual({ lower: 0, upper: 0.2 })
    // −0은 0으로(저장한 파일에 -0이 쓰이지 않게)
    expect(Object.is(limits('revolute', { lower: -0, upper: 1 })?.lower, 0)).toBe(true)
    expect(Object.is(limits('revolute', { lower: -1, upper: -0 })?.upper, 0)).toBe(true)
  })

  it('정리: 마찰·스프링은 세계 설명 검증의 한도로 자른다', () => {
    const joint = sanitizeJoint({
      ...defaultJoint(),
      friction: { coulomb: 2e4, viscous: 5e4 },
      spring: { kind: 'linear', stiffness: 1e7, rest: 0 }
    })
    expect(joint.friction).toEqual({ coulomb: MAX_JOINT_FORCE, viscous: MAX_JOINT_DAMPING })
    expect(joint.spring).toEqual({ kind: 'linear', stiffness: MAX_JOINT_STIFFNESS, rest: 0 })
    expect(
      sanitizeJoint({ ...defaultJoint(), spring: { kind: 'constantForce', force: 1e9 } }).spring
    ).toEqual({ kind: 'constantForce', force: MAX_JOINT_FORCE })
    expect(
      sanitizeJoint({ ...defaultJoint(), friction: { coulomb: Infinity, viscous: 0 } }).friction
    ).toEqual({ coulomb: 0.02, viscous: 0 })
  })

  it('정리: 구동의 감속비·스풀 지름은 범위 밖이면 기본값, 장치·단 id는 겹침과 빈 값만 뺀다', () => {
    const drive = (value: JointSettings['drive']): JointSettings['drive'] =>
      sanitizeJoint({ ...defaultJoint('prismatic'), drive: value }).drive
    // 서보: 편집 자세의 서보 위치는 0..1 밖·유한하지 않으면 0.5, 방향은 −1이 아니면 1
    expect(
      drive({ kind: 'servo', servo: 'gone', gearRatio: 1001, editPosition: 1.5, direction: 1 })
    ).toEqual({
      kind: 'servo',
      servo: 'gone',
      gearRatio: 1,
      editPosition: 0.5,
      direction: 1
    })
    expect(
      drive({ kind: 'servo', servo: 's', gearRatio: 2, editPosition: 0.35, direction: -1 })
    ).toEqual({ kind: 'servo', servo: 's', gearRatio: 2, editPosition: 0.35, direction: -1 })
    expect(
      drive({
        kind: 'servo',
        servo: 's',
        gearRatio: 2,
        editPosition: NaN,
        direction: 0 as unknown as 1
      })
    ).toMatchObject({ editPosition: 0.5, direction: 1 })
    expect(
      drive({ kind: 'crServo', servo: 's', gearRatio: 0.5, spoolDiameter: 0.0005, direction: -1 })
    ).toEqual({
      kind: 'crServo',
      servo: 's',
      gearRatio: 0.5,
      spoolDiameter: DEFAULT_SPOOL_DIAMETER,
      direction: -1
    })
    expect(
      drive({
        kind: 'motor',
        motors: ['m1'],
        gearRatio: 2,
        spoolDiameter: 0.04,
        rigging: { kind: 'continuous', stages: ['', 's2', 's3', 's2'] }
      })
    ).toEqual({
      kind: 'motor',
      motors: ['m1'],
      gearRatio: 2,
      spoolDiameter: 0.04,
      rigging: { kind: 'continuous', stages: ['s2', 's3'] }
    })
    expect(drive({ kind: 'stage' })).toEqual({ kind: 'stage' })
  })

  it('모든 구동 종류의 새 값은 정리해도 그대로다', () => {
    for (const kind of JOINT_DRIVE_KINDS) {
      const joint = { ...defaultJoint('prismatic'), drive: defaultJointDrive(kind) }
      expect(sanitizeJoint(joint)).toEqual(joint)
      expect(sameJoint(sanitizeJoint(joint), joint)).toBe(true)
    }
  })

  it('같은지 비교는 모든 칸을 본다', () => {
    const base: JointSettings = {
      ...defaultJoint('prismatic'),
      spring: { kind: 'linear', stiffness: 10, rest: 0 },
      drive: {
        kind: 'motor',
        motors: ['a', 'b'],
        gearRatio: 1,
        spoolDiameter: 0.03,
        rigging: { kind: 'cascade', stages: ['s'] }
      }
    }
    expect(sameJoint(base, structuredClone(base))).toBe(true)
    expect(sameJoint(undefined, undefined)).toBe(true)
    expect(sameJoint(base, undefined)).toBe(false)
    const changed: Partial<JointSettings>[] = [
      { type: 'revolute' },
      { anchor: [0, 0, 0.001] },
      { axis: 'y' },
      { axisSign: -1 },
      { limits: { lower: 0, upper: 0.6 } },
      { friction: { coulomb: 1, viscous: 0.4 } },
      { spring: { kind: 'linear', stiffness: 10, rest: 0.1 } },
      { spring: { kind: 'constantForce', force: 10 } },
      { spring: null },
      { drive: { ...base.drive, motors: ['b', 'a'] } as JointSettings['drive'] },
      {
        drive: {
          ...base.drive,
          rigging: { kind: 'continuous', stages: ['s'] }
        } as JointSettings['drive']
      },
      { drive: { kind: 'stage' } }
    ]
    for (const patch of changed) expect(sameJoint(base, { ...base, ...patch })).toBe(false)
  })

  it('종류를 바꾸면 기본값 그대로인 한계·마찰만 새 종류의 기본값이 된다', () => {
    expect(jointTypePatch(defaultJoint(), 'prismatic')).toEqual(defaultJoint('prismatic'))
    // 제한 없는 회전 관절을 직선으로 바꾸면 직선 기본 한계(직선은 한계가 늘 있다)
    expect(jointTypePatch({ ...defaultJoint(), limits: null }, 'prismatic').limits).toEqual({
      lower: 0,
      upper: 0.5
    })
    const edited = { ...defaultJoint(), friction: { coulomb: 0.1, viscous: 0 } }
    expect(jointTypePatch(edited, 'prismatic')).toMatchObject({
      type: 'prismatic',
      limits: { lower: 0, upper: 0.5 },
      friction: { coulomb: 0.1, viscous: 0 }
    })
  })
})
