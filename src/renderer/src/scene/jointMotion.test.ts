import { Group, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { clampJointValue, jointAxisVector, jointMotionMatrix } from './jointMotion'
import { transformToMatrix, worldMatrix, type JointSettings, type SceneObjects } from './model'

const joint = (patch: Partial<JointSettings> = {}): JointSettings => ({
  type: 'revolute',
  anchor: [0, 0, 0],
  axis: 'y',
  axisSign: 1,
  limits: { lower: -Math.PI / 2, upper: Math.PI / 2 },
  friction: { coulomb: 0.02, viscous: 0.001 },
  spring: null,
  drive: { kind: 'none' },
  ...patch
})

const apply = (matrix: Matrix4, x: number, y: number, z: number): Vector3 =>
  new Vector3(x, y, z).applyMatrix4(matrix)

const expectVector = (actual: Vector3, expected: [number, number, number]): void => {
  expect(actual.x).toBeCloseTo(expected[0], 12)
  expect(actual.y).toBeCloseTo(expected[1], 12)
  expect(actual.z).toBeCloseTo(expected[2], 12)
}

describe('관절 움직임 A·M(q)·A⁻¹', () => {
  it('축은 오브젝트 로컬 축 하나와 부호다', () => {
    expect(jointAxisVector({ axis: 'z', axisSign: -1 }).toArray()).toEqual([0, 0, -1])
    expect(jointAxisVector({ axis: 'x', axisSign: 1 }).toArray()).toEqual([1, 0, 0])
  })

  it('q = 0은 항등이다(편집 자세)', () => {
    expect(jointMotionMatrix(joint({ anchor: [0.1, 0.2, 0.3] }), 0).equals(new Matrix4())).toBe(
      true
    )
    expect(jointMotionMatrix(joint({ type: 'prismatic' }), 0).equals(new Matrix4())).toBe(true)
  })

  it('회전 관절은 앵커를 지나는 축 둘레 오른손 +로 돌리고 앵커는 그대로다', () => {
    // 앵커 (0.1, 0, 0)을 지나는 +Y 축 둘레 90°: 앵커에서 +X로 0.2 떨어진 점은 −Z로 간다(오른손: X → −Z)
    const m = jointMotionMatrix(joint({ anchor: [0.1, 0, 0] }), Math.PI / 2)
    expectVector(apply(m, 0.1, 0, 0), [0.1, 0, 0])
    expectVector(apply(m, 0.3, 0, 0), [0.1, 0, -0.2])
    // 축 부호를 바꾸면 반대로 돈다
    const reversed = jointMotionMatrix(joint({ anchor: [0.1, 0, 0], axisSign: -1 }), Math.PI / 2)
    expectVector(apply(reversed, 0.3, 0, 0), [0.1, 0, 0.2])
  })

  it('직선 관절은 축 방향으로 q m 옮기고 앵커와 관계없다', () => {
    const m = jointMotionMatrix(joint({ type: 'prismatic', axis: 'z', anchor: [1, 2, 3] }), 0.25)
    expectVector(apply(m, 0.5, 0, 0), [0.5, 0, 0.25])
  })

  it('미리보기 값은 한계 안으로 자르고, 한계 없는 회전 관절은 그대로다', () => {
    expect(clampJointValue(joint(), 3)).toBe(Math.PI / 2)
    expect(clampJointValue(joint(), -3)).toBe(-Math.PI / 2)
    expect(clampJointValue(joint({ limits: null }), 7)).toBe(7)
  })
})

describe('worldMatrix의 관절 덮어쓰기(F 포커스·IMU·무게중심 표시)', () => {
  // 로봇 (1, 0)에서 90° 돌아 있고, 팔(관절, 앵커는 팔 로컬 (−0.1, 0, 0), +Y 축)은 로봇 앞 0.2 m 높이 0.3 m, 손은 팔 끝
  const objects: SceneObjects = {
    bot: {
      id: 'bot',
      name: 'Bot',
      kind: 'robot',
      parentId: null,
      transform: { position: [1, 0, 0], rotation: [0, 0, Math.PI / 2] }
    },
    arm: {
      id: 'arm',
      name: 'Arm',
      kind: 'group',
      parentId: 'bot',
      transform: { position: [0.2, 0, 0.3], rotation: [0, 0, 0.3] },
      joint: joint({ anchor: [-0.1, 0, 0] })
    },
    hand: {
      id: 'hand',
      name: 'Hand',
      kind: 'part',
      parentId: 'arm',
      transform: { position: [0.15, 0, 0], rotation: [0.1, 0, 0] }
    }
  }
  const q = 0.7
  const motion = jointMotionMatrix(objects.arm.joint!, q)
  const override = {
    id: 'bot',
    transform: objects.bot.transform,
    joints: new Map([['arm', motion]])
  }

  it('씬 뷰의 노드 구조(부모 · 로컬 · 안쪽 그룹 · 자식)와 같은 행렬이다', () => {
    // SceneObjectsView처럼 그룹을 쌓는다: 로봇 → 팔 노드(문서 변환) → 안쪽 관절 그룹 → 손 노드
    const robot = new Group()
    robot.applyMatrix4(transformToMatrix(objects.bot.transform))
    const arm = new Group()
    arm.applyMatrix4(transformToMatrix(objects.arm.transform))
    const inner = new Group()
    inner.applyMatrix4(motion)
    const hand = new Group()
    hand.applyMatrix4(transformToMatrix(objects.hand.transform))
    robot.add(arm)
    arm.add(inner)
    inner.add(hand)
    robot.updateMatrixWorld(true)
    const computed = worldMatrix(objects, 'hand', override)
    hand.matrixWorld.elements.forEach((v, i) => expect(computed.elements[i]).toBeCloseTo(v, 12))
  })

  it('관절 오브젝트 자신의 행렬에도 들어가고(형상이 같이 돈다), 앵커는 그 자리에 남는다', () => {
    const moved = worldMatrix(objects, 'arm', override)
    const still = worldMatrix(objects, 'arm')
    expectVector(apply(moved, -0.1, 0, 0), apply(still, -0.1, 0, 0).toArray())
    expect(apply(moved, 0.2, 0, 0).distanceTo(apply(still, 0.2, 0, 0))).toBeGreaterThan(0.1)
  })

  it('관절 위의 오브젝트(로봇)와 덮어쓰기 없는 계산은 그대로다', () => {
    expect(worldMatrix(objects, 'bot', override).equals(worldMatrix(objects, 'bot'))).toBe(true)
    const empty = { id: 'bot', transform: objects.bot.transform, joints: new Map() }
    expect(worldMatrix(objects, 'hand', empty).equals(worldMatrix(objects, 'hand'))).toBe(true)
  })
})
