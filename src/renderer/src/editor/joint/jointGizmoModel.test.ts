import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { jointMotionMatrix } from '../../scene/jointMotion'
import type { JointSettings, SceneObjects } from '../../scene/model'
import { jointFrameMatrix, jointGizmoLines } from './jointGizmoModel'

const joint = (patch: Partial<JointSettings> = {}): JointSettings => ({
  type: 'revolute',
  anchor: [0.1, 0, 0],
  axis: 'z',
  axisSign: 1,
  limits: { lower: 0, upper: Math.PI / 2 },
  friction: { coulomb: 0, viscous: 0 },
  spring: null,
  drive: { kind: 'none' },
  ...patch
})

const points = (lines: ReturnType<typeof jointGizmoLines>['limits']): Vector3[] => {
  const array = lines.getAttribute('position').array
  const result: Vector3[] = []
  for (let i = 0; i < array.length; i += 3)
    result.push(new Vector3(array[i], array[i + 1], array[i + 2]))
  return result
}

const expectNear = (actual: Vector3, expected: [number, number, number]): void => {
  expect(actual.x).toBeCloseTo(expected[0], 6)
  expect(actual.y).toBeCloseTo(expected[1], 6)
  expect(actual.z).toBeCloseTo(expected[2], 6)
}

describe('관절 표시의 선', () => {
  it('회전 관절: 축 화살표는 앵커에서 + 방향, 한계 호는 앵커 둘레 아래 → 위 한계와 끝점', () => {
    const lines = jointGizmoLines(joint())
    const axis = points(lines.axis)
    expectNear(axis[0], [0.1, 0, 0])
    expectNear(axis[1], [0.1, 0, 0.12])
    // +Z 축의 기준 방향은 로컬 X, 오른손으로 90°면 +Y
    const [lower, upper] = lines.ends
    expectNear(lower, [0.16, 0, 0])
    expectNear(upper, [0.1, 0.06, 0])
    // 호의 점은 모두 앵커에서 반지름만큼(마지막 둘은 0 자리 눈금)
    const arc = points(lines.limits).slice(0, -2)
    for (const point of arc) expect(point.distanceTo(new Vector3(0.1, 0, 0))).toBeCloseTo(0.06, 6)
    // 축을 뒤집으면 호도 반대로 돈다(오른손 방향 그대로)
    const reversed = jointGizmoLines(joint({ axisSign: -1 }))
    expectNear(reversed.ends[1], [0.1, -0.06, 0])
    expectNear(points(reversed.axis)[1], [0.1, 0, -0.12])
  })

  it('한계 없는 회전 관절은 한 바퀴 원(끝점 없음), 직선 관절은 아래–위 한계 선분', () => {
    expect(jointGizmoLines(joint({ limits: null })).ends).toEqual([])
    const slide = jointGizmoLines(
      joint({ type: 'prismatic', axis: 'x', limits: { lower: -0.1, upper: 0.4 } })
    )
    const [lower, upper] = points(slide.limits)
    expectNear(lower, [0, 0, 0])
    expectNear(upper, [0.5, 0, 0])
  })

  it('관절 틀은 자기 움직임을 빼고 부모(바깥 관절 포함)의 표시 자세를 따른다', () => {
    const objects: SceneObjects = {
      bot: {
        id: 'bot',
        name: 'Bot',
        kind: 'robot',
        parentId: null,
        transform: { position: [1, 0, 0], rotation: [0, 0, 0] }
      },
      lift: {
        id: 'lift',
        name: 'Lift',
        kind: 'group',
        parentId: 'bot',
        transform: { position: [0, 0, 0.1], rotation: [0, 0, 0] },
        joint: joint({ type: 'prismatic', limits: { lower: 0, upper: 0.5 } })
      },
      wrist: {
        id: 'wrist',
        name: 'Wrist',
        kind: 'part',
        parentId: 'lift',
        transform: { position: [0.2, 0, 0], rotation: [0, 0, 0] },
        joint: joint()
      }
    }
    const override = {
      id: 'bot',
      transform: {
        position: [2, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number]
      },
      joints: new Map([
        ['lift', jointMotionMatrix(objects.lift.joint!, 0.3)],
        ['wrist', jointMotionMatrix(objects.wrist.joint!, 1)]
      ])
    }
    expectNear(jointFrameMatrix(objects, 'wrist', null).position, [1.2, 0, 0.1])
    // 로봇 (2, 0), 리프트 +0.3 m(Z), 손목 자신의 회전은 틀에 넣지 않는다
    const frame = jointFrameMatrix(objects, 'wrist', override)
    expectNear(frame.position, [2.2, 0, 0.4])
    expect(
      frame.quaternion.angleTo(jointFrameMatrix(objects, 'wrist', null).quaternion)
    ).toBeCloseTo(0, 9)
  })
})
