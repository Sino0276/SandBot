import { Box3, EdgesGeometry, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { cylinderOutlineGeometry, prismGeometry } from './fieldPartGeometry'

// 6b 부품 표시 형상(spec-6b §8): 볼록 기둥과 원기둥 윤곽

const PENTAGON = [
  { x: 0.05, y: -0.2 },
  { x: 0.05, y: 0.2 },
  { x: -0.1, y: 0.2 },
  { x: -0.2, y: 0 },
  { x: -0.1, y: -0.2 }
]

describe('prismGeometry', () => {
  it('삼각형 수 = 뚜껑 2(n − 2) + 옆 2n, 경계 상자 = 다각형 범위 × ±height/2', () => {
    const geometry = prismGeometry(PENTAGON, 0.01)
    const n = PENTAGON.length
    expect(geometry.getAttribute('position').count).toBe(3 * (2 * (n - 2) + 2 * n))
    expect(geometry.index).toBeNull()
    const box = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never)
    expect(box.min.toArray()).toEqual([-0.2, -0.2, -0.005].map((v) => Math.fround(v)))
    expect(box.max.toArray()).toEqual([0.05, 0.2, 0.005].map((v) => Math.fround(v)))
    geometry.dispose()
  })

  it('모든 삼각형의 법선이 바깥(중심에서 삼각형 중점으로)을 본다', () => {
    const geometry = prismGeometry(PENTAGON, 0.02)
    const position = geometry.getAttribute('position')
    const centroid = new Vector3(
      PENTAGON.reduce((sum, p) => sum + p.x, 0) / PENTAGON.length,
      PENTAGON.reduce((sum, p) => sum + p.y, 0) / PENTAGON.length,
      0
    )
    const v = [new Vector3(), new Vector3(), new Vector3()]
    for (let t = 0; t < position.count / 3; t++) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(position, 3 * t + k)
      const normal = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]))
      expect(normal.length()).toBeGreaterThan(0)
      const middle = v[0].clone().add(v[1]).add(v[2]).divideScalar(3)
      expect(normal.dot(middle.sub(centroid))).toBeGreaterThan(0)
    }
    geometry.dispose()
  })

  it('1° 모서리 윤곽은 기둥의 모서리만 남긴다(뚜껑·옆면의 대각선 없음): 3n개', () => {
    const geometry = prismGeometry(PENTAGON, 0.02)
    const edges = new EdgesGeometry(geometry, 1)
    expect(edges.getAttribute('position').count / 2).toBe(3 * PENTAGON.length)
    edges.dispose()
    geometry.dispose()
  })
})

describe('cylinderOutlineGeometry', () => {
  it('원 둘(분할마다 선분) + 옆 선 넷, 자기 y축 둘레 반지름·높이', () => {
    const geometry = cylinderOutlineGeometry(0.0133, 0.43, 32)
    const position = geometry.getAttribute('position')
    expect(position.count / 2).toBe(2 * 32 + 4)
    for (let i = 0; i < position.count; i++) {
      const p = new Vector3().fromBufferAttribute(position, i)
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(0.0133, 6)
      expect(Math.abs(p.y)).toBeCloseTo(0.215, 6)
    }
    geometry.dispose()
  })
})
