import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  ancestorIds,
  constrainTransform,
  findRobotId,
  getTransformInFrame,
  isCodeGroup,
  isInSubtree,
  matrixToTransform,
  transformToMatrix,
  type SceneObjects,
  type Transform,
  type Vec3
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

// 결정적인 난수(테스트가 매번 같은 값을 쓰게)
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

const maxDifference = (a: Matrix4, b: Matrix4): number =>
  Math.max(...a.elements.map((value, i) => Math.abs(value - b.elements[i])))

// 지금까지 쓰던 Three.js 추출(쿼터니언 → Euler 'ZYX')
function threeEuler(matrix: Matrix4): Vec3 {
  const quaternion = new Quaternion()
  matrix.decompose(new Vector3(), quaternion, new Vector3())
  const euler = new Euler().setFromQuaternion(quaternion, 'ZYX')
  return [euler.x, euler.y, euler.z]
}

describe('matrixToTransform(ZYX 추출)', () => {
  const random = seededRandom(7)
  const angle = (limit: number): number => (random() * 2 - 1) * limit

  it('무작위 회전·위치는 행렬로 되돌리면 같고, 극에서 먼 곳에서는 Three.js와 같은 각이다', () => {
    for (let i = 0; i < 2000; i++) {
      const transform: Transform = {
        position: [angle(3), angle(3), angle(3)],
        rotation: [angle(Math.PI), angle(Math.PI / 2), angle(Math.PI)]
      }
      const matrix = transformToMatrix(transform)
      const result = matrixToTransform(matrix)
      expect(maxDifference(transformToMatrix(result), matrix)).toBeLessThan(1e-12)
      result.position.forEach((v, k) => expect(v).toBeCloseTo(transform.position[k], 12))
      if (Math.abs(transform.rotation[1]) < 89 * DEG) {
        const expected = threeEuler(matrix)
        result.rotation.forEach((v, k) => expect(Math.abs(v - expected[k])).toBeLessThan(1e-12))
      }
    }
  })

  it('피치 ±90° 근처에서도 행렬이 정확히 되돌아온다(Three.js는 1e-4까지 틀린다)', () => {
    for (const gap of [1e-3, 4e-4, 1e-5, 1e-7, 1e-9, 1e-11, 1e-13, 0]) {
      for (let i = 0; i < 200; i++) {
        const pitch = (i % 2 ? 1 : -1) * (Math.PI / 2 - gap)
        const matrix = transformToMatrix({
          position: [0, 0, 0],
          rotation: [angle(Math.PI), pitch, angle(Math.PI)]
        })
        const result = matrixToTransform(matrix)
        expect(maxDifference(transformToMatrix(result), matrix)).toBeLessThan(1e-11)
        expect(Math.abs(result.rotation[1] - pitch)).toBeLessThan(1e-7)
      }
    }
    // 예전 추출은 이 회전에서 1.6e-4 정도 틀렸다(리뷰에서 잰 값)
    const banded = transformToMatrix({
      position: [0, 0, 0],
      rotation: [0.4, Math.PI / 2 - 4e-4, 0.7]
    })
    const old = threeEuler(banded)
    expect(
      maxDifference(transformToMatrix({ position: [0, 0, 0], rotation: old }), banded)
    ).toBeGreaterThan(1e-4)
    expect(maxDifference(transformToMatrix(matrixToTransform(banded)), banded)).toBeLessThan(1e-14)
  })

  it('정확히 ±90°(축 맞바꿈 정렬)면 Three.js처럼 롤을 0으로 두고 요에 합친다', () => {
    const matrix = transformToMatrix({ position: [0, 0, 0], rotation: [0.3, -Math.PI / 2, 0.5] })
    const { rotation } = matrixToTransform(matrix)
    expect(rotation[0]).toBe(0)
    expect(rotation[1]).toBeCloseTo(-Math.PI / 2, 12)
    expect(rotation[2]).toBeCloseTo(0.8, 12)
  })
})

describe('부모 관계 도우미', () => {
  const part = (id: string, parentId: string | null): SceneObjects[string] => ({
    id,
    name: id,
    kind: 'part',
    parentId,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  })

  it('순환이 있어도 멈춘다', () => {
    const loop: SceneObjects = { a: part('a', 'b'), b: part('b', 'a') }
    expect(findRobotId(loop, 'a')).toBeNull()
    expect(ancestorIds(loop, 'a')).toEqual(['b'])
    expect(isInSubtree(loop, 'a', 'c')).toBe(false)
  })

  it('하위인지 판단하고, 그룹만 코드 범위다', () => {
    expect(isInSubtree(objects, 'webcam', 'robot')).toBe(true)
    expect(isInSubtree(objects, 'robot', 'robot')).toBe(true)
    expect(isInSubtree(objects, 'robot', 'webcam')).toBe(false)
    expect(isCodeGroup({ ...objects.webcam, kind: 'group' })).toBe(true)
    expect(isCodeGroup(objects.webcam)).toBe(false)
  })
})
