import { describe, expect, it } from 'vitest'
import {
  activeRobotId,
  constrainTransform,
  findRobotId,
  getTransformInFrame,
  type SceneObjects,
  type Transform
} from './model'

const DEG = Math.PI / 180

// 필드 (1, 2)에서 왼쪽(+Y 방향)을 보고 있는 로봇, 앞쪽 위에 웹캠, 로봇 밖에 콘 하나
const objects: SceneObjects = {
  robot: {
    id: 'robot',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [1, 2, 0], rotation: [0, 0, 90 * DEG] }
  },
  webcam: {
    id: 'webcam',
    name: 'Webcam',
    kind: 'part',
    parentId: 'robot',
    transform: { position: [0.2, 0, 0.3], rotation: [0, 0, 0] }
  },
  cone: {
    id: 'cone',
    name: 'Cone',
    kind: 'part',
    parentId: null,
    transform: { position: [-1, 0, 0], rotation: [0, 0, 0] }
  }
}

function expectTransform(actual: Transform, expected: Transform): void {
  actual.position.forEach((v, i) => expect(v).toBeCloseTo(expected.position[i], 9))
  actual.rotation.forEach((v, i) => expect(v).toBeCloseTo(expected.rotation[i], 9))
}

describe('getTransformInFrame', () => {
  it('필드 기준: 로봇의 회전을 반영한 필드 좌표를 준다', () => {
    // 로봇 앞(+X_robot)은 필드 +Y 방향이다
    expectTransform(getTransformInFrame(objects, 'webcam', 'field'), {
      position: [1, 2.2, 0.3],
      rotation: [0, 0, 90 * DEG]
    })
  })

  it('로봇 기준: 로봇 중심에서의 오프셋을 준다', () => {
    expectTransform(getTransformInFrame(objects, 'webcam', 'robot'), {
      position: [0.2, 0, 0.3],
      rotation: [0, 0, 0]
    })
  })

  it('로봇 자신은 로봇 기준으로 원점이다', () => {
    expectTransform(getTransformInFrame(objects, 'robot', 'robot'), {
      position: [0, 0, 0],
      rotation: [0, 0, 0]
    })
  })

  it('로봇에 속하지 않은 오브젝트는 로봇 기준이어도 필드 좌표를 준다', () => {
    expectTransform(getTransformInFrame(objects, 'cone', 'robot'), objects.cone.transform)
  })
})

describe('로봇 찾기', () => {
  it('파트가 속한 로봇을 찾는다', () => {
    expect(findRobotId(objects, 'webcam')).toBe('robot')
    expect(findRobotId(objects, 'cone')).toBeNull()
  })

  it('선택이 없거나 로봇 밖이면 씬의 첫 로봇을 쓴다', () => {
    expect(activeRobotId(objects, null)).toBe('robot')
    expect(activeRobotId(objects, 'cone')).toBe('robot')
    expect(activeRobotId({ cone: objects.cone }, null)).toBeNull()
  })
})

describe('constrainTransform', () => {
  it('최상위 로봇은 바닥 위 평면 이동과 요 회전만 남긴다', () => {
    expect(
      constrainTransform(objects.robot, { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3] })
    ).toEqual({ position: [1, 2, 0], rotation: [0, 0, 0.3] })
  })

  it('파트는 제약하지 않는다', () => {
    const value: Transform = { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3] }
    expect(constrainTransform(objects.webcam, value)).toBe(value)
  })
})
