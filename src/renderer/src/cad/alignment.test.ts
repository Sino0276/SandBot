import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { transformToMatrix } from '../scene/model'
import {
  ALIGNMENT_PRESETS,
  alignmentRotation,
  cadRootTransform,
  findPreset,
  isValidAlignment,
  type CadAlignment
} from './alignment'

function rotate(alignment: CadAlignment, v: [number, number, number]): number[] {
  return new Vector3(...v).applyMatrix4(alignmentRotation(alignment)).toArray()
}

function expectVector(actual: number[], expected: number[]): void {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9))
}

describe('alignmentRotation', () => {
  it('Z-up(+Z 위, -Y 앞): CAD -Y가 로봇 앞(+X), CAD +Z가 위(+Z)가 된다', () => {
    const zUp = ALIGNMENT_PRESETS.zUp
    expectVector(rotate(zUp, [0, -1, 0]), [1, 0, 0])
    expectVector(rotate(zUp, [0, 0, 1]), [0, 0, 1])
    // 오른손 좌표계 유지: CAD +X는 로봇 왼쪽(+Y)
    expectVector(rotate(zUp, [1, 0, 0]), [0, 1, 0])
  })

  it('Y-up(+Y 위, +Z 앞): CAD +Z가 로봇 앞, CAD +Y가 위가 된다', () => {
    const yUp = ALIGNMENT_PRESETS.yUp
    expectVector(rotate(yUp, [0, 0, 1]), [1, 0, 0])
    expectVector(rotate(yUp, [0, 1, 0]), [0, 0, 1])
    expectVector(rotate(yUp, [1, 0, 0]), [0, 1, 0])
  })
})

describe('cadRootTransform', () => {
  it('정렬한 모델의 바닥 중심을 로봇 원점에 맞춘다', () => {
    const bounds = {
      min: [1, 2, 3] as [number, number, number],
      max: [3, 6, 4] as [number, number, number]
    }
    const matrix = transformToMatrix(cadRootTransform(bounds, ALIGNMENT_PRESETS.yUp))
    // 루트 노드의 피벗은 경계 상자 중심이므로, CAD 점 p는 (p - 중심)으로 들어간다
    const center = new Vector3(2, 4, 3.5)
    const corners = [
      [1, 2, 3],
      [3, 2, 3],
      [1, 6, 3],
      [3, 6, 3],
      [1, 2, 4],
      [3, 2, 4],
      [1, 6, 4],
      [3, 6, 4]
    ].map((p) => new Vector3(...p).sub(center).applyMatrix4(matrix))
    const min = corners.reduce((a, b) => a.clone().min(b))
    const max = corners.reduce((a, b) => a.clone().max(b))
    expectVector([(min.x + max.x) / 2, (min.y + max.y) / 2, min.z], [0, 0, 0])
    // Y-up이므로 CAD Y 길이(4)가 높이가 된다
    expect(max.z - min.z).toBeCloseTo(4, 9)
  })
})

describe('프리셋과 유효성', () => {
  it('위·앞 축이 같은 축이면 무효다', () => {
    expect(isValidAlignment({ upAxis: '+Z', forwardAxis: '-Z' })).toBe(false)
    expect(isValidAlignment({ upAxis: '+Z', forwardAxis: '+X' })).toBe(true)
  })

  it('현재 축 조합에 맞는 프리셋을 찾는다', () => {
    expect(findPreset({ upAxis: '+Y', forwardAxis: '+Z' })).toBe('yUp')
    expect(findPreset({ upAxis: '+Z', forwardAxis: '-Y' })).toBe('zUp')
    expect(findPreset({ upAxis: '+X', forwardAxis: '+Y' })).toBeNull()
  })
})
